"use client";

import {
  InitiatedSourceAssetUploadViewSchema,
  SourceAssetPrepareViewSchema,
  UploadedSourceAssetViewSchema,
  type InitiatedSourceAssetUploadView,
  type SourceAssetProcessingView,
} from "@gapproof/contracts";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  SYNTHETIC_RECOGNITION_NOTICE,
  SYNTHETIC_RECOGNITION_SUCCESS,
  SYNTHETIC_RECOGNITION_SUCCESS_DETAIL,
  createSyntheticRecognitionIntent,
  isSyntheticRecognitionRetryUnknown,
  startSyntheticRecognition,
  syntheticRecognitionErrorMessage,
} from "@/lib/source-recognition";
import { beginSourceUploadLifecycle } from "@/lib/source-upload-lifecycle";
import { uploadJourneyPosition } from "@/lib/source-upload-journey";
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

type StartRecognitionStatus = "idle" | "starting" | "success" | "error" | "network_unknown";

const uploadJourneyLabels = ["选择图片", "安全上传", "基础检查", "准备内容", "确认题目"] as const;

function formatUploadError(error: unknown): string {
  if (error instanceof ApiClientError) return "上传或图片检查没有完成，请稍后重试。";
  if (error instanceof Error && error.message === "UPLOAD_RESPONSE_MISMATCH") {
    return "文件信息与本次上传不一致，请重新选择图片。";
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
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");
  const [qualityPassed, setQualityPassed] = useState(false);
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [startRecognitionStatus, setStartRecognitionStatus] = useState<StartRecognitionStatus>("idle");
  const [startRecognitionMessage, setStartRecognitionMessage] = useState("");
  const [recognitionCaseId, setRecognitionCaseId] = useState<string | null>(null);
  const startIntentRef = useRef<ReturnType<typeof createSyntheticRecognitionIntent> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const cleanupLifecycle = beginSourceUploadLifecycle(mountedRef, () => {
      activeAbortRef.current?.abort("PAGE_LEFT");
    });
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") activeAbortRef.current?.abort("PAGE_HIDDEN");
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      cleanupLifecycle();
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, []);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

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
    startIntentRef.current = null;
    activeAbortRef.current?.abort("NEW_FILE");
    setQualityPassed(false);
    setGuardianConfirmed(false);
    setStartRecognitionStatus("idle");
    setStartRecognitionMessage("");
    setRecognitionCaseId(null);
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
    setSafeState("idle", "已选择 1 张图片；点击“开始上传”后才会上传。");
  };

  const showInspectionView = (view: SourceAssetProcessingView) => {
    setQualityPassed(view.processingStatus === "succeeded" && view.quality?.status === "passed");
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

  const startRecognition = async () => {
    const assetId = intentRef.current?.assetId;
    if (!assetId || !qualityPassed || !guardianConfirmed || startRecognitionStatus === "starting" || startRecognitionStatus === "success" || startRecognitionStatus === "network_unknown") return;

    const intent = createSyntheticRecognitionIntent();
    startIntentRef.current = intent;
    setStartRecognitionStatus("starting");
    setStartRecognitionMessage("正在准备体验识别内容。本次不会读取上传图片中的文字。");
    try {
      const response = await startSyntheticRecognition(assetId, intent);
      if (response.data.assetId !== assetId) throw new Error("START_RECOGNITION_ASSET_MISMATCH");
      setRecognitionCaseId(response.data.caseId);
      setStartRecognitionStatus("success");
      setStartRecognitionMessage(SYNTHETIC_RECOGNITION_SUCCESS);
    } catch (error) {
      if (!mountedRef.current) return;
      if (isSyntheticRecognitionRetryUnknown(error)) {
        setStartRecognitionStatus("network_unknown");
        setStartRecognitionMessage(syntheticRecognitionErrorMessage(error));
        return;
      }
      setStartRecognitionStatus("error");
      setStartRecognitionMessage(syntheticRecognitionErrorMessage(error));
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
        setSafeState("creating", "正在准备上传……");
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
        setSafeState("hashing", "正在检查图片，请稍候……");
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

  const openFilePicker = () => {
    if (!inputRef.current) return;
    inputRef.current.value = "";
    inputRef.current.click();
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
          <h1 id="source-upload-title">上传一张错题或作业图片</h1>
          <p>先把你愿意用于检查的图片交给系统；上传完成后不会自动开始识别或生成学习结论。</p>
        </div>
      </div>
      <div className="upload-layout">
        <article className="upload-card">
          <input
            ref={inputRef}
            id="source-upload-input"
            name="source-upload"
            type="file"
            accept={ACCEPTED_SOURCE_UPLOAD_TYPES.join(",")}
            tabIndex={-1}
            onChange={event => chooseFile(event.currentTarget.files?.[0] ?? null)}
            aria-describedby={!file ? "source-upload-help" : undefined}
          />
          {!file ? <div className="upload-picker-panel" data-upload-picker>
            <label
              className="upload-picker"
              htmlFor="source-upload-input"
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openFilePicker();
                }
              }}
            >
              <span className="upload-picker-title">选择图片</span>
              <span className="upload-picker-detail">JPG、PNG、WebP · 1B–10MiB</span>
            </label>
            <p id="source-upload-help" className="upload-help">上传前请先遮盖姓名、学校、班级等不必要的个人信息。</p>
          </div> : <div className="selected-upload-preview" data-selected-upload>
            {currentValidation.ok && previewUrl ? <img src={previewUrl} alt="你刚刚选择的学习材料预览"/> : <div className="selected-upload-placeholder" aria-hidden="true"/>}
            <div><strong>已选择 1 张图片</strong><span>{file.type.replace("image/", "").toUpperCase()} · {file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KiB` : `${(file.size / 1024 / 1024).toFixed(1)} MiB`}</span><small>尚未上传；不显示本地文件名。</small></div>
          </div>}
          {file && currentValidation.ok ? <ol className="upload-journey-steps" aria-label="材料处理进度">{uploadJourneyLabels.map((label, index) => {
            const position = uploadJourneyPosition(status, startRecognitionStatus);
            return <li key={label} className={index < position ? "complete" : index === position ? "current" : "pending"} aria-current={index === position ? "step" : undefined}><span>{index < position ? "✓" : index + 1}</span><strong>{label}</strong></li>;
          })}</ol> : null}
          <UploadStatusMessage status={status} message={message}/>
          {file ? <div className="upload-actions">
            <button className="primary-blue" type="button" onClick={() => void startUpload()} disabled={!canSubmit}>
              {primaryLabel}
            </button>
            <button className="secondary-button" type="button" onClick={openFilePicker} disabled={isBusy || startRecognitionStatus === "starting"}>更换图片</button>
          </div> : null}
          {status === "succeeded"
            ? <div className="upload-success" data-upload-success><strong>图片基础检查通过</strong><span>识别尚未开始；不会自动生成学习结论。</span></div>
            : null}
          {status === "succeeded" && qualityPassed
            ? <section className="recognition-start-card" data-recognition-start aria-labelledby="recognition-start-title">
              <h2 id="recognition-start-title">继续体验识别</h2>
              <p>{SYNTHETIC_RECOGNITION_NOTICE}</p>
              <label className="recognition-guardian-confirmation">
                <input
                  type="checkbox"
                  checked={guardianConfirmed}
                  disabled={startRecognitionStatus === "starting" || startRecognitionStatus === "success" || startRecognitionStatus === "network_unknown"}
                  onChange={event => setGuardianConfirmed(event.currentTarget.checked)}
                />
                <span>我已获得监护人确认（未满18岁必需）</span>
              </label>
              <button
                className="primary-blue"
                type="button"
                onClick={() => void startRecognition()}
                disabled={!guardianConfirmed || startRecognitionStatus === "starting" || startRecognitionStatus === "success" || startRecognitionStatus === "network_unknown"}
              >开始识别并继续</button>
              {startRecognitionMessage
                ? <p
                  className={`recognition-start-message ${startRecognitionStatus === "error" || startRecognitionStatus === "network_unknown" ? "error" : startRecognitionStatus === "success" ? "success" : ""}`}
                  aria-live={startRecognitionStatus === "error" || startRecognitionStatus === "network_unknown" ? "assertive" : "polite"}
                  role={startRecognitionStatus === "error" || startRecognitionStatus === "network_unknown" ? "alert" : undefined}
                  data-recognition-start-status={startRecognitionStatus}
                >{startRecognitionMessage}</p>
                : null}
              {startRecognitionStatus === "success"
                ? <p className="recognition-start-detail">{SYNTHETIC_RECOGNITION_SUCCESS_DETAIL}</p>
                : null}
              {startRecognitionStatus === "success" && recognitionCaseId
                ? <button type="button" className="secondary-button recognition-review-link" onClick={() => router.push(`/materials/${recognitionCaseId}/review`)}>查看并确认识别内容</button>
                : null}
              {startRecognitionStatus !== "success"
                ? <a className="secondary-button recognition-return-link" href="/student/today">返回今日</a>
                : null}
            </section>
            : null}
        </article>
        <aside className="upload-guidance">
          <h2>上传前看一眼</h2>
          <ul>
            <li>尽量让题目和批改痕迹都在图片里。</li>
            <li>先遮盖姓名、学校和班级等不必要信息。</li>
            <li>上传后仍需由你确认，才会继续下一步。</li>
          </ul>
          <p>后续识别、确认和诊断会在明确的下一步中进行。</p>
        </aside>
      </div>
    </section>
  </AppShell>;
}
