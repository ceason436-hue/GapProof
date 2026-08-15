"use client";

import {
  InitiatedSourceAssetUploadViewSchema,
  SourceAssetPrepareViewSchema,
  UploadedSourceAssetViewSchema,
  type InitiatedSourceAssetUploadView,
  type SourceAssetProcessingView,
} from "@gapproof/contracts";
import { useEffect, useRef, useState } from "react";
import { apiPost, apiPut, ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import {
  ACCEPTED_SOURCE_UPLOAD_TYPES,
  buildSourceAssetPrepareRequest,
  buildSourceAssetUploadRequest,
  sha256Hex,
  validateSourceUploadFile,
} from "@/lib/source-upload";
import {
  isTerminalSourceInspectionStatus,
  pollSourceAssetInspection,
  sourceInspectionMessage,
} from "@/lib/source-inspection";
import { AppShell } from "./app-shell";

type UploadStatus =
  | "idle"
  | "hashing"
  | "creating"
  | "uploading"
  | "preparing"
  | "queued"
  | "processing"
  | "needs_confirmation"
  | "succeeded"
  | "retryable_error"
  | "failed"
  | "timeout"
  | "error";

type UploadIntent = {
  file: File;
  idempotencyKey: string;
  body: ReturnType<typeof buildSourceAssetUploadRequest>;
  target?: InitiatedSourceAssetUploadView["upload"];
  assetId?: string;
};

function formatUploadError(error: unknown): string {
  if (error instanceof ApiClientError) return "上传或图片检查没有完成，请稍后重试。";
  if (error instanceof Error && error.message === "UPLOAD_RESPONSE_MISMATCH") {
    return "服务端返回的文件信息与本次上传不一致，请重新选择图片。";
  }
  if (error instanceof Error && error.message === "SOURCE_INSPECTION_ASSET_MISMATCH") {
    return "图片检查结果与本次上传不一致，请重新选择图片。";
  }
  return "上传结果暂时未知，请确认网络后重试。";
}

function UploadStatusMessage({ status, message }: { status: UploadStatus; message: string }) {
  const isError = status === "error" || status === "needs_confirmation" || status === "retryable_error" || status === "failed";
  const isSuccess = status === "succeeded";
  return <p
    className={`upload-status-message ${isError ? "error" : isSuccess ? "success" : ""}`}
    aria-live={isError ? "assertive" : "polite"}
    role={isError ? "alert" : undefined}
    data-upload-status={status}
  >{message}</p>;
}

export function SourceUpload({ studentId }: { studentId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") activeAbortRef.current?.abort("PAGE_HIDDEN");
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      mountedRef.current = false;
      activeAbortRef.current?.abort("PAGE_LEFT");
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, []);

  const setSafeState = (nextStatus: UploadStatus, nextMessage: string) => {
    if (!mountedRef.current) return;
    setStatus(nextStatus);
    setMessage(nextMessage);
  };

  const isBusy = status === "hashing" || status === "creating" || status === "uploading" || status === "preparing" || status === "queued" || status === "processing";
  const currentValidation = file ? validateSourceUploadFile(file) : { ok: false as const, message: "" };
  const canSubmit = file !== null && currentValidation.ok && !isBusy && status !== "succeeded" && status !== "needs_confirmation" && status !== "failed";

  const chooseFile = (nextFile: File | null) => {
    intentRef.current = null;
    activeAbortRef.current?.abort("NEW_FILE");
    setFile(nextFile);
    if (!nextFile) {
      setSafeState("idle", "请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");
      return;
    }
    const validation = validateSourceUploadFile(nextFile);
    if (!validation.ok) {
      setSafeState("error", validation.message);
      return;
    }
    setSafeState("idle", "图片已选择；点击“开始上传”后才会创建一次上传意图。文件名只用于本次请求。");
  };

  const showInspectionView = (view: SourceAssetProcessingView) => {
    switch (view.processingStatus) {
      case "uploaded":
        setSafeState("preparing", sourceInspectionMessage(view));
        break;
      case "queued":
        setSafeState("queued", sourceInspectionMessage(view));
        break;
      case "processing":
        setSafeState("processing", sourceInspectionMessage(view));
        break;
      case "needs_confirmation":
        setSafeState("needs_confirmation", sourceInspectionMessage(view));
        break;
      case "succeeded":
        setSafeState("succeeded", sourceInspectionMessage(view));
        break;
      case "retryable_error":
        setSafeState("retryable_error", sourceInspectionMessage(view));
        break;
      case "failed":
        setSafeState("failed", sourceInspectionMessage(view));
        break;
    }
  };

  const inspectIntent = async (intent: UploadIntent, signal: AbortSignal) => {
    if (!intent.assetId) throw new Error("SOURCE_INSPECTION_ASSET_MISSING");
    setSafeState("processing", "正在检查图片。识别尚未开始。");
    await pollSourceAssetInspection({
      assetId: intent.assetId,
      signal,
      onView: showInspectionView,
    });
  };

  const runIntent = async (intent: UploadIntent, signal: AbortSignal) => {
    try {
      let target = intent.target;
      if (!target) {
        setSafeState("creating", "正在创建本次上传意图；不会创建学生或学习 Case。");
        const initiated = await apiPost(
          "/api/v1/source-assets/uploads",
          InitiatedSourceAssetUploadViewSchema,
          intent.body,
          intent.idempotencyKey,
          signal,
        );
        target = initiated.data.upload;
        if (target.mimeType !== intent.body.mimeType || target.byteSize !== intent.body.byteSize) {
          throw new Error("UPLOAD_RESPONSE_MISMATCH");
        }
        intent.target = target;
      }

      if (!intent.assetId) {
        setSafeState("uploading", "正在上传图片；识别尚未开始。");
        const uploaded = await apiPut(
          target.path as `/api/v1/${string}`,
          UploadedSourceAssetViewSchema,
          intent.file,
          {
            "x-gapproof-upload-token": target.token,
            "Content-Type": intent.file.type,
          },
          signal,
        );
        if (
          uploaded.data.mimeType !== intent.body.mimeType ||
          uploaded.data.byteSize !== intent.body.byteSize ||
          uploaded.data.sha256 !== intent.body.sha256
        ) {
          throw new Error("UPLOAD_RESPONSE_MISMATCH");
        }
        intent.assetId = uploaded.data.assetId;
      }

      setSafeState("preparing", "上传完成，正在准备图片检查。");
      const prepared = await apiPost(
        `/api/v1/source-assets/${intent.assetId}/commands/prepare`,
        SourceAssetPrepareViewSchema,
        buildSourceAssetPrepareRequest(),
        intent.idempotencyKey,
        signal,
      );
      if (prepared.data.assetId !== intent.assetId) throw new Error("SOURCE_INSPECTION_ASSET_MISMATCH");
      if (prepared.data.processingStatus === "queued") {
        setSafeState("queued", "图片检查已排队，可以稍后回来查看。");
        await inspectIntent(intent, signal);
      } else {
        showInspectionView(prepared.data);
        if (!isTerminalSourceInspectionStatus(prepared.data.processingStatus)) {
          await inspectIntent(intent, signal);
        }
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (signal.aborted) {
        if (signal.reason === "NEW_FILE" || signal.reason === "RESET" || signal.reason === "REPLACED") return;
        setSafeState("timeout", "图片检查已暂停，可以稍后刷新。");
        return;
      }
      if (error instanceof Error && error.message === "SOURCE_INSPECTION_TIMEOUT") {
        setSafeState("timeout", "图片检查仍在处理中，可以稍后刷新。");
        return;
      }
      setSafeState("error", formatUploadError(error));
    }
  };

  const startIntent = async (intent: UploadIntent) => {
    activeAbortRef.current?.abort("REPLACED");
    const controller = new AbortController();
    activeAbortRef.current = controller;
    try {
      await runIntent(intent, controller.signal);
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null;
    }
  };

  const refreshInspection = async () => {
    const intent = intentRef.current;
    if (!intent?.assetId) return;
    activeAbortRef.current?.abort("REPLACED");
    const controller = new AbortController();
    activeAbortRef.current = controller;
    try {
      setSafeState("processing", "正在检查图片。识别尚未开始。");
      await pollSourceAssetInspection({
        assetId: intent.assetId,
        signal: controller.signal,
        onView: showInspectionView,
      });
    } catch (error) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted && (controller.signal.reason === "REPLACED" || controller.signal.reason === "RESET" || controller.signal.reason === "NEW_FILE")) return;
      if (controller.signal.aborted || (error instanceof Error && error.message === "SOURCE_INSPECTION_TIMEOUT")) {
        setSafeState("timeout", "图片检查仍在处理中，可以稍后刷新。");
      } else {
        setSafeState("error", formatUploadError(error));
      }
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null;
    }
  };

  const startUpload = async () => {
    if (!file) {
      setSafeState("error", "请先选择一张图片。");
      return;
    }
    const validation = validateSourceUploadFile(file);
    if (!validation.ok) {
      setSafeState("error", validation.message);
      return;
    }

    let intent = intentRef.current;
    if (intent?.assetId && (status === "timeout" || status === "retryable_error")) {
      await refreshInspection();
      return;
    }
    if (!intent || intent.file !== file) {
      try {
        setSafeState("hashing", "正在计算图片校验值；文件内容不会经过页面外的文本处理。");
        const sha256 = await sha256Hex(file);
        intent = {
          file,
          idempotencyKey: createBrowserUuidV7(),
          body: buildSourceAssetUploadRequest(studentId, file, sha256),
        };
        intentRef.current = intent;
      } catch {
        setSafeState("error", "图片校验失败，请重新选择后再试。");
        return;
      }
    }
    await startIntent(intent);
  };

  const reset = () => {
    intentRef.current = null;
    activeAbortRef.current?.abort("RESET");
    setFile(null);
    setSafeState("idle", "请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");
    if (inputRef.current) inputRef.current.value = "";
  };

  const primaryLabel = status === "error" && intentRef.current?.assetId
    ? "重试检查"
    : status === "error" && intentRef.current
      ? "重试上传"
      : status === "timeout" || status === "retryable_error"
        ? "重新检查"
        : status === "succeeded"
          ? "已完成"
          : isBusy
            ? "正在处理"
            : "开始上传";

  return <AppShell actionDisabled actionLabel={status === "processing" || status === "queued" ? "正在检查" : isBusy ? "正在上传" : "先选择图片"}>
    <section className="upload-page" aria-labelledby="source-upload-title">
      <div className="title-row">
        <div>
          <span className="status-chip">添加学习材料</span>
          <h1 id="source-upload-title">上传一张错题或作业图片</h1>
          <p>先把你愿意用于检查的图片交给系统；上传完成后不会自动开始识别或生成学习结论。</p>
        </div>
      </div>
      <div className="upload-layout">
        <article className="upload-card">
          <div className="upload-picker-panel">
            <label
              className="upload-picker"
              htmlFor="source-upload-input"
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
            >
              <span className="upload-picker-title">选择图片</span>
              <span className="upload-picker-detail">JPG、PNG、WebP · 1B–10MiB</span>
            </label>
            <input
              ref={inputRef}
              id="source-upload-input"
              name="source-upload"
              type="file"
              accept={ACCEPTED_SOURCE_UPLOAD_TYPES.join(",")}
              tabIndex={-1}
              onChange={event => chooseFile(event.currentTarget.files?.[0] ?? null)}
              aria-describedby="source-upload-help"
            />
            <p id="source-upload-help" className="upload-help">文件会直接上传到短期授权的对象地址；页面不会展示服务端文件名、对象键或内部编号。</p>
          </div>
          <UploadStatusMessage status={status} message={message}/>
          <div className="upload-actions">
            <button className="primary-blue" type="button" onClick={() => void startUpload()} disabled={!canSubmit}>
              {primaryLabel}
            </button>
            {(status === "error" || status === "succeeded" || status === "needs_confirmation" || status === "failed")
              ? <button className="secondary-button" type="button" onClick={reset}>重新选择图片</button>
              : null}
          </div>
          {status === "succeeded"
            ? <div className="upload-success" data-upload-success><strong>图片基础检查通过</strong><span>识别尚未开始；不会自动生成学习结论。</span></div>
            : null}
        </article>
        <aside className="upload-guidance">
          <h2>上传前看一眼</h2>
          <ul>
            <li>尽量让题目和批改痕迹都在图片里。</li>
            <li>先遮盖姓名、学校和班级等不必要信息。</li>
            <li>上传只保存本次文件元数据，不会自动创建 Case。</li>
          </ul>
          <p>后续识别、确认和诊断会在明确的下一步中进行。</p>
        </aside>
      </div>
    </section>
  </AppShell>;
}
