"use client";

import {
  InitiatedSourceAssetUploadViewSchema,
  UploadedSourceAssetViewSchema,
  type InitiatedSourceAssetUploadView,
} from "@gapproof/contracts";
import { useRef, useState } from "react";
import { apiPost, apiPut, ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import {
  ACCEPTED_SOURCE_UPLOAD_TYPES,
  buildSourceAssetUploadRequest,
  sha256Hex,
  validateSourceUploadFile,
} from "@/lib/source-upload";
import { AppShell } from "./app-shell";

type UploadStatus = "idle" | "hashing" | "creating" | "uploading" | "success" | "error";

type UploadIntent = {
  file: File;
  idempotencyKey: string;
  body: ReturnType<typeof buildSourceAssetUploadRequest>;
  target?: InitiatedSourceAssetUploadView["upload"];
};

function formatUploadError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `上传没有完成，请稍后重试（${error.response.error.code}）。`;
  }
  if (error instanceof Error && error.message === "UPLOAD_RESPONSE_MISMATCH") {
    return "服务端返回的文件信息与本次上传不一致，请重新选择图片。";
  }
  return "上传结果暂时未知，请确认网络后重试。";
}

function UploadStatusMessage({ status, message }: { status: UploadStatus; message: string }) {
  return <p
    className={`upload-status-message ${status === "error" ? "error" : status === "success" ? "success" : ""}`}
    aria-live={status === "error" ? "assertive" : "polite"}
    role={status === "error" ? "alert" : undefined}
    data-upload-status={status}
  >{message}</p>;
}

export function SourceUpload({ studentId }: { studentId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const intentRef = useRef<UploadIntent | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");

  const isBusy = status === "hashing" || status === "creating" || status === "uploading";
  const currentValidation = file ? validateSourceUploadFile(file) : { ok: false as const, message: "" };
  const canSubmit = file !== null && currentValidation.ok && !isBusy && status !== "success";

  const chooseFile = (nextFile: File | null) => {
    intentRef.current = null;
    setFile(nextFile);
    if (!nextFile) {
      setStatus("idle");
      setMessage("请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");
      return;
    }
    const validation = validateSourceUploadFile(nextFile);
    if (!validation.ok) {
      setStatus("error");
      setMessage(validation.message);
      return;
    }
    setStatus("idle");
    setMessage("图片已选择；点击“开始上传”后才会创建一次上传意图。文件名只用于本次请求。");
  };

  const runIntent = async (intent: UploadIntent) => {
    try {
      let target = intent.target;
      if (!target) {
        setStatus("creating");
        setMessage("正在创建本次上传意图；不会创建学生或学习 Case。 ");
        const initiated = await apiPost(
          "/api/v1/source-assets/uploads",
          InitiatedSourceAssetUploadViewSchema,
          intent.body,
          intent.idempotencyKey,
        );
        target = initiated.data.upload;
        if (target.mimeType !== intent.body.mimeType || target.byteSize !== intent.body.byteSize) {
          throw new Error("UPLOAD_RESPONSE_MISMATCH");
        }
        intent.target = target;
      }

      setStatus("uploading");
      setMessage("正在上传图片；识别尚未开始。 ");
      const uploaded = await apiPut(
        target.path as `/api/v1/${string}`,
        UploadedSourceAssetViewSchema,
        intent.file,
        {
          "x-gapproof-upload-token": target.token,
          "Content-Type": intent.file.type,
        },
      );
      if (
        uploaded.data.mimeType !== intent.body.mimeType ||
        uploaded.data.byteSize !== intent.body.byteSize ||
        uploaded.data.sha256 !== intent.body.sha256
      ) {
        throw new Error("UPLOAD_RESPONSE_MISMATCH");
      }
      setStatus("success");
      setMessage("上传完成，识别尚未开始。不会自动生成学习结论。");
    } catch (error) {
      setStatus("error");
      setMessage(formatUploadError(error));
    }
  };

  const startUpload = async () => {
    if (!file) {
      setStatus("error");
      setMessage("请先选择一张图片。");
      return;
    }
    const validation = validateSourceUploadFile(file);
    if (!validation.ok) {
      setStatus("error");
      setMessage(validation.message);
      return;
    }

    let intent = intentRef.current;
    if (!intent || intent.file !== file) {
      try {
        setStatus("hashing");
        setMessage("正在计算图片校验值；文件内容不会经过页面外的文本处理。 ");
        const sha256 = await sha256Hex(file);
        intent = {
          file,
          idempotencyKey: createBrowserUuidV7(),
          body: buildSourceAssetUploadRequest(studentId, file, sha256),
        };
        intentRef.current = intent;
      } catch {
        setStatus("error");
        setMessage("图片校验失败，请重新选择后再试。");
        return;
      }
    }
    await runIntent(intent);
  };

  const reset = () => {
    intentRef.current = null;
    setFile(null);
    setStatus("idle");
    setMessage("请选择一张图片，再开始上传。支持 JPG、PNG 或 WebP，大小 1B–10MiB。");
    if (inputRef.current) inputRef.current.value = "";
  };

  return <AppShell actionDisabled actionLabel={isBusy ? "正在上传" : "先选择图片"}>
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
              {status === "error" && intentRef.current ? "重试上传" : status === "success" ? "已完成" : isBusy ? "正在处理" : "开始上传"}
            </button>
            {(status === "error" || status === "success")
              ? <button className="secondary-button" type="button" onClick={reset}>重新选择图片</button>
              : null}
          </div>
          {status === "success"
            ? <div className="upload-success" data-upload-success><strong>上传完成</strong><span>识别尚未开始；不会自动生成学习结论。</span></div>
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
