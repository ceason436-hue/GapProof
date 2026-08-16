"use client";

import { AddedRealOcrBatchPageViewSchema, MAX_REAL_OCR_BATCH_PAGES, RealOcrBatchViewSchema, SourceAssetPrepareViewSchema, SourceAssetProcessingViewSchema, StartRealOcrBatchViewSchema, UploadedSourceAssetViewSchema, type RealOcrBatchView, type RecoverableOcrBatchView, type SourceAssetProcessingView } from "@gapproof/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiDeleteOnce, apiGet, apiPost, apiPostOnce, apiPutOnce, ApiClientError } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { ACCEPTED_SOURCE_UPLOAD_TYPES, buildSourceAssetPrepareRequest, sha256Hex, validateSourceUploadFile } from "@/lib/source-upload";
import { isTerminalSourceInspectionStatus, pollSourceAssetInspection, sourceInspectionMessage } from "@/lib/source-inspection";
import { beginSourceUploadLifecycle } from "@/lib/source-upload-lifecycle";
import { AppShell } from "./app-shell";
import { OcrBatchRecovery } from "./ocr-batch-recovery";

type PageStatus = "waiting" | "hashing" | "creating" | "uploading" | "checking" | "passed" | "needs_confirmation" | "retryable_error" | "network_unknown" | "failed";
type UnknownOperation = "add" | "upload" | "prepare" | "remove";
type QueueItem = { clientId: string; file: File; previewUrl: string; status: PageStatus; message: string; pageId?: string; assetId?: string | undefined; previousAssetId?: string | undefined; addKey?: string | undefined; prepareKey?: string | undefined; removeKey?: string | undefined; uploaded?: boolean; replacing?: boolean; expectedOrder?: number; unknownOperation?: UnknownOperation | undefined };
type ReorderState = { status: "idle" } | { status: "working" } | { status: "unknown"; desiredPageIds: string[] };
type ReorderOutcome = "success" | "skipped" | "unknown" | "error";
const busy = (status: PageStatus) => ["hashing", "creating", "uploading", "checking"].includes(status);
const passed = (status: PageStatus) => status === "passed";
const locked = (status: PageStatus) => status === "network_unknown";
const unknownWrite = (error: unknown) => error instanceof TypeError;

function safeError(error: unknown) {
  if (error instanceof ApiClientError && error.response.error.retryable) return "这张图片暂时没有处理完成，可以重试。";
  if (error instanceof ApiClientError) return "这张图片暂时无法完成，请重新选择或稍后重试。";
  return "处理结果暂时未知，请检查网络后再试。";
}

export function SourceUpload({ studentId, recoverableBatches = [], initialBatch, initialBatchView }: { studentId: string; recoverableBatches?: readonly RecoverableOcrBatchView[]; initialBatch?: RecoverableOcrBatchView; initialBatchView?: RealOcrBatchView }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  const batchRef = useRef<{ batchId: string; caseId: string } | null>(initialBatch ? { batchId: initialBatch.batchId, caseId: initialBatch.caseId } : null);
  const batchCreateKeyRef = useRef<string | undefined>(undefined);
  const batchCreateTitleRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [existingPages, setExistingPages] = useState<RealOcrBatchView["pages"]>(() => initialBatchView?.pages ?? []);
  const [materialTitle, setMaterialTitle] = useState(initialBatchView?.title ?? initialBatch?.title ?? "");
  const existingRemoveKeysRef = useRef(new Map<string, string>());
  const reorderKeyRef = useRef<{ intent: string; key: string } | null>(null);
  const [message, setMessage] = useState(initialBatch?.resumeKind === "wait"
    ? "这份材料正在识别。完成后仍需你核对题目内容。"
    : initialBatch?.resumeKind === "review"
      ? "识别内容已经准备好，请进入核对页面逐题确认。"
      : initialBatch?.resumeKind === "retry"
        ? "上次识别没有完成。重新确认处理说明后可以重试。"
        : "选择一张或多张图片后，再开始上传。我们会先检查图片是否清晰。");
  const [guardianConfirmed, setGuardianConfirmed] = useState(false);
  const [noticeAccepted, setNoticeAccepted] = useState(false);
  const [startStatus, setStartStatus] = useState<"idle" | "starting" | "success" | "unknown" | "error">("idle");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [reorderState, setReorderState] = useState<ReorderState>({ status: "idle" });
  const updateItems = (update: (current: QueueItem[]) => QueueItem[]) => {
    const next = update(itemsRef.current); itemsRef.current = next;
    if (mountedRef.current) setItems(next);
    return next;
  };
  const updateItem = (clientId: string, patch: Partial<QueueItem>) => updateItems(current => current.map(item => item.clientId === clientId ? { ...item, ...patch } : item));

  useEffect(() => {
    mountedRef.current = true;
    const cleanup = beginSourceUploadLifecycle(mountedRef, () => abortRef.current?.abort());
    return () => { cleanup(); for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl); };
  }, []);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const remaining = Math.max(0, MAX_REAL_OCR_BATCH_PAGES - existingPages.length - itemsRef.current.length);
    if (remaining === 0) {
      setMessage(`一份材料最多 ${MAX_REAL_OCR_BATCH_PAGES} 张图片，请移除已有图片后再添加。`);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    const additions = selected.map(file => {
      const valid = validateSourceUploadFile(file);
      return { clientId: createBrowserUuidV7(), file, previewUrl: URL.createObjectURL(file), status: valid.ok ? "waiting" as const : "failed" as const, message: valid.ok ? "尚未上传。" : valid.message };
    });
    updateItems(current => [...current, ...additions]);
    setMessage(selected.length < files.length
      ? `已加入 ${selected.length} 张图片；一份材料最多 ${MAX_REAL_OCR_BATCH_PAGES} 张，超出的图片未加入。`
      : "图片已加入队列；开始上传后会逐张检查。识别不会自动开始。");
  };
  const openPicker = () => { if (inputRef.current) { inputRef.current.value = ""; inputRef.current.click(); } };
  const moveLocalItem = (clientId: string, direction: -1 | 1) => {
    if (startStatus !== "idle" || lockedForRecognition || anyBusy || anyLocked || recoveryBusy || reorderState.status !== "idle") return;
    const current = itemsRef.current;
    const index = current.findIndex(item => item.clientId === clientId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    updateItems(() => next);
    const pageIds = completePageIds(existingPages, next);
    if (current[index].pageId && pageIds) {
      void persistPageOrder(pageIds, "图片顺序已更新。识别仍需你确认后才会开始。");
    } else {
      setMessage(current[index].pageId
        ? "已调整图片顺序；其他图片上传完成后会保存这个顺序。识别不会自动开始。"
        : "已调整图片顺序；点击上传并检查图片后会按这个顺序处理。识别不会自动开始。");
    }
  };
  const reorderExistingPage = async (pageIndex: number, direction: -1 | 1) => {
    const batch = batchRef.current;
    if (!batch || startStatus !== "idle" || lockedForRecognition || anyBusy || anyLocked || recoveryBusy || reorderState.status !== "idle" || existingPagesBusy) return;
    const target = pageIndex + direction;
    if (pageIndex < 0 || target < 0 || target >= existingPages.length) return;
    const nextExistingPages = [...existingPages];
    [nextExistingPages[pageIndex], nextExistingPages[target]] = [nextExistingPages[target], nextExistingPages[pageIndex]];
    setExistingPages(nextExistingPages);
    const pageIds = completePageIds(nextExistingPages, itemsRef.current);
    if (!pageIds) {
      setMessage("已调整图片顺序；其他图片上传完成后会保存这个顺序。识别不会自动开始。");
      return;
    }
    await persistPageOrder(pageIds, "图片顺序已更新。识别仍需你确认后才会开始。");
  };
  const recoverPageReorder = async () => {
    const batch = batchRef.current;
    if (!batch || reorderState.status !== "unknown" || recoveryBusy) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setRecoveryBusy(true);
    try {
      const current = await readBatch(batch.batchId, controller.signal);
      const actualPageIds = current.data.pages.map(page => page.pageId);
      applyAuthoritativePageOrder(current.data.pages);
      if (actualPageIds.length === reorderState.desiredPageIds.length && actualPageIds.every((pageId, index) => pageId === reorderState.desiredPageIds[index])) {
        setMessage("已确认图片顺序更新。");
      } else {
        setMessage("已读取当前材料顺序，但无法确认上次调整是否完成。请检查顺序后再操作。");
      }
      setReorderState({ status: "idle" });
    } catch {
      if (!controller.signal.aborted) setMessage("暂时无法确认图片顺序，请点击“刷新材料状态”后再继续。");
    } finally {
      if (mountedRef.current) setRecoveryBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const replaceExistingPage = (page: RealOcrBatchView["pages"][number], file: File | undefined) => {
    if (!file || anyBusy || startStatus !== "idle") return;
    const valid = validateSourceUploadFile(file);
    if (!valid.ok) {
      setMessage(valid.message);
      return;
    }
    const clientId = createBrowserUuidV7();
    updateItems(current => [...current, {
      clientId,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "waiting",
      message: `准备替换第 ${page.order} 张图片。`,
      pageId: page.pageId,
      previousAssetId: page.assetId,
      uploaded: false,
      replacing: true,
    }]);
    setExistingPages(current => current.filter(candidate => candidate.pageId !== page.pageId));
  };
  const removeExistingPage = async (page: RealOcrBatchView["pages"][number]) => {
    const batch = batchRef.current;
    if (!batch || recoveryBusy || anyBusy || startStatus !== "idle") return;
    const key = existingRemoveKeysRef.current.get(page.pageId) ?? createBrowserUuidV7();
    existingRemoveKeysRef.current.set(page.pageId, key);
    setRecoveryBusy(true);
    try {
      const response = await apiDeleteOnce(`/api/v1/ocr-batches/${batch.batchId}/pages/${page.pageId}`, RealOcrBatchViewSchema, key);
      applyAuthoritativePageOrder(response.data.pages);
      setMessage(`第 ${page.order} 张图片已从这份材料中移除。`);
    } catch (error) {
      if (unknownWrite(error)) {
        try {
          const current = await apiGet(`/api/v1/ocr-batches/${batch.batchId}`, RealOcrBatchViewSchema);
          const stillPresent = current.data.pages.some(candidate => candidate.pageId === page.pageId);
          applyAuthoritativePageOrder(current.data.pages);
          setMessage(stillPresent ? `第 ${page.order} 张图片仍在材料中，可以再次确认移除。` : `已确认第 ${page.order} 张图片已移除。`);
        } catch {
          setMessage(`暂时无法确认第 ${page.order} 张图片是否已移除，请返回材料页读取最新状态。`);
        }
      } else {
        setMessage(safeError(error));
      }
    } finally {
      setRecoveryBusy(false);
    }
  };
  const removeItem = async (clientId: string) => {
    const item = itemsRef.current.find(candidate => candidate.clientId === clientId);
    if (!item || busy(item.status) || locked(item.status)) return;
    const batch = batchRef.current;
    if (batch && item.pageId) {
      const removeKey = item.removeKey ?? createBrowserUuidV7();
      updateItem(clientId, { status: "creating", message: "正在移除这张图片…", removeKey, unknownOperation: undefined });
      try {
        await apiDeleteOnce(`/api/v1/ocr-batches/${batch.batchId}/pages/${item.pageId}`, RealOcrBatchViewSchema, removeKey);
      } catch (error) {
        if (unknownWrite(error)) {
          updateItem(clientId, { status: "network_unknown", unknownOperation: "remove", message: "这张图片的移除结果需要确认。请先读取最新状态，不要重复点击移除。" });
          return;
        }
        updateItem(clientId, { status: "retryable_error", message: safeError(error) });
        return;
      }
    }
    URL.revokeObjectURL(item.previewUrl); updateItems(current => current.filter(candidate => candidate.clientId !== clientId));
  };
  const replaceItem = (clientId: string, file: File | undefined) => {
    if (!file) return;
    const item = itemsRef.current.find(candidate => candidate.clientId === clientId);
    if (!item || busy(item.status) || locked(item.status)) return;
    const valid = validateSourceUploadFile(file);
    URL.revokeObjectURL(item.previewUrl);
    updateItem(clientId, {
      file,
      previewUrl: URL.createObjectURL(file),
      status: valid.ok ? "waiting" : "failed",
      message: valid.ok ? "新图片尚未上传。" : valid.message,
      previousAssetId: item.assetId,
      assetId: undefined,
      addKey: undefined,
      prepareKey: undefined,
      removeKey: undefined,
      uploaded: false,
      replacing: Boolean(item.pageId),
      unknownOperation: undefined,
    });
  };
  const showInspection = (clientId: string, view: SourceAssetProcessingView) => {
    const status: PageStatus = view.processingStatus === "succeeded" && view.quality?.status === "passed" ? "passed" : view.processingStatus === "needs_confirmation" ? "needs_confirmation" : view.processingStatus === "retryable_error" ? "retryable_error" : view.processingStatus === "failed" ? "failed" : "checking";
    updateItem(clientId, { status, message: status === "passed" ? "图片检查通过，等待开始识别。" : sourceInspectionMessage(view) });
  };
  const ensureBatch = async (signal: AbortSignal) => {
    if (batchRef.current) return batchRef.current;
    const title = batchCreateTitleRef.current ?? materialTitle.trim();
    if (!title) throw new Error("MATERIAL_TITLE_REQUIRED");
    const createKey = batchCreateKeyRef.current ?? createBrowserUuidV7();
    batchCreateKeyRef.current = createKey;
    batchCreateTitleRef.current = title;
    const response = await apiPostOnce("/api/v1/ocr-batches", RealOcrBatchViewSchema, { studentId, title }, createKey, signal);
    setMaterialTitle(response.data.title);
    const created = { batchId: response.data.batchId, caseId: response.data.caseId }; batchRef.current = created; return created;
  };
  const readBatch = (batchId: string, signal: AbortSignal) =>
    apiGet(`/api/v1/ocr-batches/${batchId}`, RealOcrBatchViewSchema, signal);
  const completePageIds = (pages: RealOcrBatchView["pages"], queue: readonly QueueItem[]) => {
    const queuePageIds = queue.map(item => item.pageId);
    return queuePageIds.every((pageId): pageId is string => pageId !== undefined)
      ? [...pages.map(page => page.pageId), ...queuePageIds]
      : null;
  };
  const applyAuthoritativePageOrder = (pages: RealOcrBatchView["pages"]) => {
    const queuedByPageId = new Map(itemsRef.current.flatMap(item => item.pageId ? [[item.pageId, item] as const] : []));
    const queuedPageIds = new Set(queuedByPageId.keys());
    setExistingPages(pages.filter(page => !queuedPageIds.has(page.pageId)));
    const orderedQueue = pages.flatMap(page => {
      const item = queuedByPageId.get(page.pageId);
      return item ? [item] : [];
    });
    if (orderedQueue.length === itemsRef.current.length) updateItems(() => orderedQueue);
  };
  const persistPageOrder = async (pageIds: string[], successMessage: string): Promise<ReorderOutcome> => {
    const batch = batchRef.current;
    if (!batch || reorderState.status !== "idle") return "skipped";
    const intent = pageIds.join(",");
    const key = reorderKeyRef.current?.intent === intent ? reorderKeyRef.current.key : createBrowserUuidV7();
    reorderKeyRef.current = { intent, key };
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setReorderState({ status: "working" });
    try {
      const response = await apiPostOnce(`/api/v1/ocr-batches/${batch.batchId}/commands/reorder-pages`, RealOcrBatchViewSchema, { pageIds }, key, controller.signal);
      applyAuthoritativePageOrder(response.data.pages);
      reorderKeyRef.current = null;
      setReorderState({ status: "idle" });
      setMessage(successMessage);
      return "success";
    } catch (error) {
      if (controller.signal.aborted) return "skipped";
      if (unknownWrite(error)) {
        setReorderState({ status: "unknown", desiredPageIds: pageIds });
        setMessage("图片顺序的调整结果需要确认。请先读取最新顺序，不会重复操作。");
        return "unknown";
      }
      reorderKeyRef.current = null;
      setReorderState({ status: "idle" });
      setMessage(safeError(error));
      return "error";
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const persistCurrentPageOrder = () => {
    const pageIds = completePageIds(existingPages, itemsRef.current);
    return pageIds ? persistPageOrder(pageIds, "图片顺序已保存。识别仍需你确认后才会开始。") : Promise.resolve<ReorderOutcome>("skipped");
  };
  const runPage = async (clientId: string, batchId: string, signal: AbortSignal) => {
    const initial = itemsRef.current.find(item => item.clientId === clientId);
    if (!initial || initial.status === "failed" || passed(initial.status)) return;
    let operation: UnknownOperation = initial.uploaded ? "prepare" : "add";
    try {
      let assetId = initial.assetId;
      if (!initial.uploaded) {
        updateItem(clientId, { status: "hashing", message: "正在校验图片…" });
        const sha256 = await sha256Hex(initial.file);
        const addKey = initial.addKey ?? createBrowserUuidV7();
        const batchView = await readBatch(batchId, signal);
        const expectedOrder = batchView.data.pages.length + 1;
        updateItem(clientId, { status: "creating", message: "正在准备上传…", addKey, expectedOrder, unknownOperation: undefined });
        const page = await apiPostOnce(
          initial.replacing && initial.pageId
            ? `/api/v1/ocr-batches/${batchId}/pages/${initial.pageId}/commands/replace`
            : `/api/v1/ocr-batches/${batchId}/pages/uploads`,
          AddedRealOcrBatchPageViewSchema,
          { fileName: initial.file.name, mimeType: initial.file.type, byteSize: initial.file.size, sha256 },
          addKey,
          signal,
        );
        if (page.data.upload.mimeType !== initial.file.type || page.data.upload.byteSize !== initial.file.size) throw new Error("UPLOAD_RESPONSE_MISMATCH");
        assetId = page.data.page.assetId;
        updateItem(clientId, { assetId, pageId: page.data.page.pageId, status: "uploading", message: "正在安全上传，识别尚未开始。" });
        operation = "upload";
        await apiPutOnce(page.data.upload.path as `/api/v1/${string}`, UploadedSourceAssetViewSchema, initial.file, { "x-gapproof-upload-token": page.data.upload.token, "Content-Type": initial.file.type }, signal);
        updateItem(clientId, { uploaded: true, replacing: false });
      }
      if (!assetId) throw new Error("SOURCE_ASSET_ID_MISSING");
      updateItem(clientId, { assetId, status: "checking", message: "正在检查图片。" });
      const prepareKey = initial.prepareKey ?? createBrowserUuidV7();
      updateItem(clientId, { prepareKey, unknownOperation: undefined });
      operation = "prepare";
      const prepared = await apiPostOnce(`/api/v1/source-assets/${assetId}/commands/prepare`, SourceAssetPrepareViewSchema, buildSourceAssetPrepareRequest(), prepareKey, signal);
      if ("assetId" in prepared.data && prepared.data.assetId !== assetId) throw new Error("SOURCE_INSPECTION_ASSET_MISMATCH");
      if ("quality" in prepared.data) showInspection(clientId, prepared.data);
      if (!("processingStatus" in prepared.data) || !isTerminalSourceInspectionStatus(prepared.data.processingStatus)) await pollSourceAssetInspection({ assetId, signal, onView: view => showInspection(clientId, view) });
    } catch (error) {
      if (!signal.aborted) {
        updateItem(clientId, unknownWrite(error)
          ? { status: "network_unknown", unknownOperation: operation, message: operation === "upload" ? "这张图片的上传结果需要确认。请先读取最新状态，不要重复上传。" : operation === "prepare" ? "这张图片的检查结果需要确认。请先读取最新状态，不要重复提交检查。" : "这张图片的添加结果需要确认。请先读取最新状态，不要重复添加。" }
          : { status: "retryable_error", message: safeError(error) });
      }
    }
  };
  const recoverUnknownPage = async (clientId: string) => {
    const item = itemsRef.current.find(candidate => candidate.clientId === clientId);
    const batch = batchRef.current;
    if (!item || item.status !== "network_unknown" || !batch || recoveryBusy) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setRecoveryBusy(true);
    try {
      if (item.unknownOperation === "remove") {
        const current = await readBatch(batch.batchId, controller.signal);
        const stillPresent = item.pageId !== undefined && current.data.pages.some(page => page.pageId === item.pageId);
        applyAuthoritativePageOrder(current.data.pages);
        if (!stillPresent) {
          URL.revokeObjectURL(item.previewUrl);
          updateItems(items => items.filter(candidate => candidate.clientId !== clientId));
        } else {
          updateItem(clientId, { status: "retryable_error", unknownOperation: undefined, message: "最新状态显示这张图片仍在材料中。确认后可以再次点击移除。" });
        }
        return;
      }

      if (item.unknownOperation === "add") {
        const current = await readBatch(batch.batchId, controller.signal);
        const page = item.replacing && item.pageId
          ? current.data.pages.find(candidate => candidate.pageId === item.pageId)
          : item.expectedOrder === undefined
            ? undefined
            : current.data.pages.find(candidate => candidate.order === item.expectedOrder);
        if (page === undefined) {
          updateItem(clientId, { message: "还无法确认这张图片是否加入材料。请返回材料页或今日页查看后再继续。" });
          return;
        }
        if (item.replacing && item.previousAssetId !== undefined && page.assetId === item.previousAssetId) {
          updateItem(clientId, { status: "retryable_error", unknownOperation: undefined, message: "最新状态显示仍是替换前的图片。确认后可以重新提交这次替换。" });
          return;
        }
        updateItem(clientId, { pageId: page.pageId, assetId: page.assetId, previousAssetId: undefined, uploaded: page.status !== "pending_upload", replacing: page.status === "pending_upload", status: "waiting", unknownOperation: undefined, message: item.replacing ? "已确认新图片替换成功，正在继续处理。" : "已确认图片已加入材料，继续处理前请重新点击上传并检查。" });
        if (page.status === "pending_upload") {
          updateItem(clientId, { status: "retryable_error", message: "已确认图片已加入，但上传尚未完成。请点击重试上传。" });
        } else {
          await runPage(clientId, batch.batchId, controller.signal);
          if (!controller.signal.aborted) await persistCurrentPageOrder();
        }
        return;
      }

      if (!item.assetId) {
        updateItem(clientId, { message: "还无法确认这张图片的材料状态。请返回材料页或今日页查看。" });
        return;
      }
      let inspection: SourceAssetProcessingView;
      try {
        inspection = (await apiGet(`/api/v1/source-assets/${item.assetId}`, SourceAssetProcessingViewSchema, controller.signal)).data;
      } catch {
        updateItem(clientId, { message: "还无法确认这张图片的材料状态。请返回材料页或今日页查看。" });
        return;
      }
      if (item.unknownOperation === "upload") {
        if (inspection.processingStatus === "uploaded" || inspection.processingStatus === "queued" || inspection.processingStatus === "processing" || inspection.processingStatus === "needs_confirmation" || inspection.processingStatus === "succeeded" || inspection.processingStatus === "retryable_error" || inspection.processingStatus === "failed") {
          updateItem(clientId, { uploaded: true, status: "waiting", unknownOperation: undefined, message: "已确认图片已经上传，继续检查前请重新点击上传并检查。" });
          await runPage(clientId, batch.batchId, controller.signal);
          if (!controller.signal.aborted) await persistCurrentPageOrder();
        }
        return;
      }
      if (inspection.processingStatus === "uploaded") {
        updateItem(clientId, { uploaded: true, status: "retryable_error", unknownOperation: undefined, message: "已确认图片已上传，但检查尚未开始。请点击重试检查。" });
        return;
      }
      showInspection(clientId, inspection);
      if (!isTerminalSourceInspectionStatus(inspection.processingStatus)) await pollSourceAssetInspection({ assetId: item.assetId, signal: controller.signal, onView: view => showInspection(clientId, view) });
      if (!controller.signal.aborted) await persistCurrentPageOrder();
    } catch (error) {
      if (!controller.signal.aborted) updateItem(clientId, { status: "network_unknown", message: "仍无法确认这张图片的状态。请返回材料页或今日页查看，不要重复提交。" });
    } finally {
      if (mountedRef.current) setRecoveryBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };
  const uploadAll = async () => {
    const eligible = itemsRef.current.filter(item => ["waiting", "retryable_error"].includes(item.status)); if (!eligible.length) return;
    if (!batchRef.current && materialTitle.trim().length === 0) {
      setMessage("请先给这份材料起个名字，方便以后在错题本里找到它。");
      return;
    }
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setMessage("正在逐张上传并检查图片；识别尚未开始。");
    try {
      const batch = await ensureBatch(controller.signal);
      for (const item of eligible) await runPage(item.clientId, batch.batchId, controller.signal);
      const reorderOutcome = await persistCurrentPageOrder();
      if (reorderOutcome === "success" || reorderOutcome === "skipped") setMessage(itemsRef.current.every(item => passed(item.status)) ? "所有图片都准备好了。确认后才会开始图片识别。" : "有图片还没准备好，请按提示处理后再开始。");
    }
    catch (error) {
      if (!controller.signal.aborted) setMessage(unknownWrite(error) ? "材料准备结果暂时没有返回。再次点击“上传并检查图片”会沿用刚才的操作，不会新建另一份材料。" : safeError(error));
    }
    finally { if (abortRef.current === controller) abortRef.current = null; }
  };
  const retryPage = async (clientId: string) => {
    const batch = batchRef.current;
    if (!batch) return void uploadAll();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    await runPage(clientId, batch.batchId, controller.signal);
    if (!controller.signal.aborted) await persistCurrentPageOrder();
    if (abortRef.current === controller) abortRef.current = null;
  };
  const startRecognition = async () => {
    const batch = batchRef.current;
    if (!batch || !guardianConfirmed || !noticeAccepted || reorderState.status !== "idle" || recoveryBusy || !itemsRef.current.every(item => passed(item.status)) || !existingPages.every(page => page.status === "succeeded")) return;
    const controller = new AbortController(); abortRef.current = controller; setStartStatus("starting"); setMessage("正在提交识别请求…");
    const command = initialBatch?.resumeKind === "retry" ? "retry-recognition" : "start-recognition";
    try { const response = await apiPost(`/api/v1/ocr-batches/${batch.batchId}/commands/${command}`, StartRealOcrBatchViewSchema, { guardianConfirmed: true, processingNoticeAccepted: true }, createBrowserUuidV7(), controller.signal); setCaseId(response.data.caseId); setStartStatus("success"); setMessage("识别已开始。完成后请核对识别出的题目内容；系统不会自动生成学习结论。"); }
    catch (error) { if (!controller.signal.aborted) { if (error instanceof TypeError) { setStartStatus("unknown"); setMessage("提交结果暂时未知，请刷新后查看材料状态，不要重复提交。"); } else { setStartStatus("error"); setMessage(safeError(error)); } } }
    finally { if (abortRef.current === controller) abortRef.current = null; }
  };
  const recoverRecognitionStart = async () => {
    const batch = batchRef.current;
    if (!batch || recoveryBusy) return;
    const controller = new AbortController(); abortRef.current?.abort(); abortRef.current = controller; setRecoveryBusy(true);
    try {
      const response = await apiGet(`/api/v1/ocr-batches/${batch.batchId}`, RealOcrBatchViewSchema, controller.signal);
      if (response.data.status === "collecting" || response.data.status === "ready") {
        setStartStatus("error"); setMessage("最新状态显示识别尚未开始。请重新确认后再开始。");
      } else {
        setCaseId(response.data.caseId); setStartStatus("success"); setMessage("已读取最新状态。请进入识别内容页面查看处理进度或核对结果。");
      }
    } catch (error) { if (!controller.signal.aborted) setMessage(safeError(error)); }
    finally { if (mountedRef.current) setRecoveryBusy(false); if (abortRef.current === controller) abortRef.current = null; }
  };
  const allPassed = items.length + existingPages.length > 0 && items.every(item => passed(item.status)) && existingPages.every(page => page.status === "succeeded");
  const anyBusy = items.some(item => busy(item.status));
  const anyLocked = items.some(item => locked(item.status));
  const existingPagesBusy = existingPages.some(page => ["pending_upload", "uploaded", "queued", "processing"].includes(page.status));
  const editable = startStatus === "idle" || startStatus === "error";
  const lockedForRecognition = initialBatch?.resumeKind === "wait" || initialBatch?.resumeKind === "review" || initialBatch?.resumeKind === "retry";
  const hasExistingPages = existingPages.length > 0;
  const reorderDisabled = !editable || lockedForRecognition || anyBusy || anyLocked || recoveryBusy || existingPagesBusy || reorderState.status !== "idle";
  const localReorderDisabled = reorderDisabled || items.length < 2;
  return <AppShell actionHref="/student/today?source=api" actionDisabled={anyBusy} actionLabel={anyBusy ? "正在处理" : "返回今日"}><section className="upload-page" aria-labelledby="source-upload-title"><div className="title-row"><div><h1 id="source-upload-title">上传错题、作业或试卷</h1><p>可一次添加多张同一份材料的图片。每张图片通过检查并由你确认后，才会开始图片识别。</p></div></div>{recoverableBatches.length > 0 ? <OcrBatchRecovery batches={recoverableBatches} compact/> : null}<div className="upload-layout"><article className="upload-card"><label className="material-title-field"><span>这份材料叫什么？</span><input type="text" value={materialTitle} maxLength={80} disabled={batchRef.current !== null || batchCreateKeyRef.current !== undefined || anyBusy || lockedForRecognition} onChange={event => setMaterialTitle(event.currentTarget.value)} placeholder="例如：8 月 16 日英语周练" aria-describedby="material-title-help"/><small id="material-title-help">用一个容易记住的名称，之后可以在错题本里按名称搜索。不要填写姓名、学校或班级。</small></label>
    <input ref={inputRef} id="source-upload-input" name="source-upload" type="file" multiple disabled={lockedForRecognition} accept={ACCEPTED_SOURCE_UPLOAD_TYPES.join(",")} tabIndex={-1} onChange={event => addFiles(event.currentTarget.files)} aria-describedby={items.length === 0 && !lockedForRecognition ? "source-upload-help" : undefined} />
    {items.length === 0 && !hasExistingPages && !lockedForRecognition ? <div className="upload-picker-panel" data-upload-picker><button type="button" className="upload-picker" onClick={openPicker}><span className="upload-picker-title">选择图片</span><span className="upload-picker-detail">可多选 JPG、PNG、WebP · 每张不超过 10 MB</span></button><p id="source-upload-help" className="upload-help">上传前请遮盖姓名、学校、班级等不必要的个人信息。</p></div> : items.length > 0 || hasExistingPages ? <><div className="upload-queue-heading"><strong>材料中已有 {existingPages.length + items.length} 张图片</strong>{editable && !lockedForRecognition ? <button type="button" className="secondary-button compact-upload-button" onClick={openPicker}>继续添加</button> : null}</div>{hasExistingPages ? <ol className="upload-queue existing-upload-pages" aria-label="材料中已有的图片">{existingPages.map((page, index) => <li key={page.pageId} className="upload-queue-item" data-page-status={page.status}><span className="existing-page-thumb">第 {page.order} 页</span><div className="upload-queue-copy"><strong>第 {page.order} 张图片</strong><span>{page.status === "pending_upload" ? "上次上传未完成，请替换或移除" : page.status === "retryable_error" ? "处理未完成" : page.status === "failed" ? "处理失败" : "已保存在这份材料中"}</span></div>{editable && !lockedForRecognition && reorderState.status === "idle" ? <div className="queue-item-actions"><button type="button" className="queue-action queue-order-action" disabled={reorderDisabled || index === 0} onClick={() => void reorderExistingPage(index, -1)} aria-label={`上移第 ${page.order} 张图片`}>上移</button><button type="button" className="queue-action queue-order-action" disabled={reorderDisabled || index === existingPages.length - 1} onClick={() => void reorderExistingPage(index, 1)} aria-label={`下移第 ${page.order} 张图片`}>下移</button><label className="queue-action">替换<input className="visually-hidden" type="file" accept={ACCEPTED_SOURCE_UPLOAD_TYPES.join(",")} onChange={event => replaceExistingPage(page, event.currentTarget.files?.[0])}/></label><button type="button" className="queue-action" disabled={recoveryBusy || anyBusy || reorderState.status !== "idle"} onClick={() => void removeExistingPage(page)}>移除</button></div> : null}</li>)}</ol> : null}{items.length > 0 ? <ol className="upload-queue" aria-label="本次新选择的图片">{items.map((item, index) => <li key={item.clientId} className="upload-queue-item" data-page-status={item.status}><img src={item.previewUrl} alt={`本次选择的第 ${index + 1} 张学习材料预览`} /><div className="upload-queue-copy"><strong>{item.replacing ? "替换图片" : `新增第 ${index + 1} 张`}</strong><span>{item.message}</span>{locked(item.status) ? <span className="upload-unknown-actions"><button type="button" className="queue-action" disabled={recoveryBusy} onClick={() => void recoverUnknownPage(item.clientId)}>{recoveryBusy ? "正在读取状态" : "读取最新状态"}</button><Link href="/materials/new">返回材料页</Link><Link href="/student/today">返回今日</Link></span> : null}</div>{editable && !busy(item.status) && !locked(item.status) && reorderState.status === "idle" ? <div className="queue-item-actions"><button type="button" className="queue-action queue-order-action" disabled={localReorderDisabled || index === 0} onClick={() => moveLocalItem(item.clientId, -1)} aria-label={`上移第 ${index + 1} 张待上传图片`}>上移</button><button type="button" className="queue-action queue-order-action" disabled={localReorderDisabled || index === items.length - 1} onClick={() => moveLocalItem(item.clientId, 1)} aria-label={`下移第 ${index + 1} 张待上传图片`}>下移</button><label className="queue-action">重新选择<input className="visually-hidden" type="file" accept={ACCEPTED_SOURCE_UPLOAD_TYPES.join(",")} onChange={event => replaceItem(item.clientId, event.currentTarget.files?.[0])}/></label><button type="button" className="queue-action" onClick={() => void removeItem(item.clientId)}>移除</button>{item.status === "retryable_error" ? <button type="button" className="queue-action" onClick={() => void retryPage(item.clientId)}>重试</button> : null}</div> : null}</li>)}</ol> : null}</> : null}
    <p className="upload-status-message" aria-live="polite" data-recognition-start-status={startStatus === "error" ? "error" : undefined}>{message}</p>{items.length > 0 && editable ? <div className="upload-actions"><button className="primary-blue" type="button" onClick={() => void uploadAll()} disabled={anyBusy || anyLocked || reorderState.status !== "idle" || (!batchRef.current && materialTitle.trim().length === 0) || items.every(item => item.status === "passed" || item.status === "failed")}>{anyBusy ? "正在处理" : "上传并检查图片"}</button></div> : null}
    {allPassed && startStatus !== "success" ? <section className="recognition-start-card" data-real-recognition-start aria-labelledby="recognition-start-title"><h2 id="recognition-start-title">{initialBatch?.resumeKind === "retry" ? "确认后重新识别" : "确认后开始识别"}</h2><p>确认后，图片会被发送给教育场景识别服务处理。识别结果仍需你核对；它不是学习结论或学习效果证明。</p><label className="recognition-guardian-confirmation"><input type="checkbox" checked={noticeAccepted} disabled={startStatus === "starting"} onChange={event => setNoticeAccepted(event.currentTarget.checked)} /><span>我已阅读并同意本次图片处理说明</span></label><label className="recognition-guardian-confirmation"><input type="checkbox" checked={guardianConfirmed} disabled={startStatus === "starting"} onChange={event => setGuardianConfirmed(event.currentTarget.checked)} /><span>我已获得监护人确认（未满 18 岁时必需）</span></label><button className="primary-blue" type="button" onClick={() => void startRecognition()} disabled={!guardianConfirmed || !noticeAccepted || startStatus === "starting" || reorderState.status !== "idle" || recoveryBusy}>{startStatus === "starting" ? "正在提交识别" : initialBatch?.resumeKind === "retry" ? "重新识别" : "开始识别"}</button></section> : null}
    {reorderState.status === "unknown" ? <div className="upload-success upload-reorder-unknown" data-reorder-unknown><strong>图片顺序需要确认</strong><span>请读取最新顺序，不会重复调整图片。</span><button type="button" className="secondary-button" disabled={recoveryBusy} onClick={() => void recoverPageReorder()}>{recoveryBusy ? "正在读取" : "刷新材料状态"}</button></div> : null}
    {startStatus === "unknown" ? <div className="upload-success" data-recognition-unknown data-recognition-start-status="network_unknown"><strong>识别状态需要确认</strong><span>先读取最新状态，不会重复提交识别请求。</span><button type="button" className="secondary-button" disabled={recoveryBusy} onClick={() => void recoverRecognitionStart()}>{recoveryBusy ? "正在读取" : "读取最新状态"}</button><a href="/student/today">返回今日</a></div> : null}
    {startStatus === "success" && caseId ? <div className="upload-success" data-recognition-start-status="success"><strong>识别正在处理</strong><span>识别完成后请先确认题目内容。</span><Link className="secondary-button recognition-review-link" href={`/materials/${caseId}/review`}>查看识别进度</Link></div> : null}
  </article><aside className="upload-guidance"><h2>上传前看一眼</h2><ul><li>按试卷或作业的顺序添加图片。</li><li>尽量让题目和批改痕迹完整清晰。</li><li>识别后的题目仍需要你确认。</li></ul><p>图片只用于本次材料识别与后续确认。</p></aside></div></section></AppShell>;
}
