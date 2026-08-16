"use client";

import { RealOcrBatchViewSchema } from "@gapproof/contracts";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiClientError, apiRequest } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";

export function MaterialTitleEditor({ batchId, initialTitle, initialVersion, onSaved }: { batchId: string; initialTitle: string; initialVersion: number; onSaved?: (title: string, version: number) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [version, setVersion] = useState(initialVersion);
  const [state, setState] = useState<"idle" | "saving" | "error" | "conflict" | "unknown">("idle");
  const [message, setMessage] = useState("");
  const intentKey = useRef<string | undefined>(undefined);

  useEffect(() => {
    setTitle(initialTitle);
    setSavedTitle(initialTitle);
    setVersion(initialVersion);
    setState("idle");
    setMessage("");
    intentKey.current = undefined;
  }, [initialTitle, initialVersion]);

  function changeTitle(value: string) {
    setTitle(value.slice(0, 80));
    setState("idle");
    setMessage("");
    intentKey.current = undefined;
  }

  function cancel() {
    setTitle(savedTitle);
    setEditing(false);
    setState("idle");
    setMessage("");
    intentKey.current = undefined;
  }

  async function save() {
    const normalized = title.trim();
    if (!normalized) {
      setState("error");
      setMessage("请填写一个方便自己辨认的材料名称。");
      return;
    }
    if (normalized === savedTitle) {
      setEditing(false);
      return;
    }
    const key = intentKey.current ?? createBrowserUuidV7();
    intentKey.current = key;
    setState("saving");
    setMessage("");
    try {
      const response = await apiRequest(`/api/v1/ocr-batches/${batchId}/commands/rename`, RealOcrBatchViewSchema, {
        method: "POST",
        body: { expectedVersion: version, title: normalized },
        idempotencyKey: key,
      });
      setSavedTitle(response.data.title);
      setTitle(response.data.title);
      setVersion(response.data.version);
      onSaved?.(response.data.title, response.data.version);
      setEditing(false);
      setState("idle");
      intentKey.current = undefined;
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError) {
        const conflict = error.response.error.code === "VERSION_CONFLICT";
        setState(conflict ? "conflict" : "error");
        setMessage(conflict ? "材料刚刚有更新，请先读取最新名称。" : "暂时没有改名成功，请检查后重试。");
      } else {
        setState("unknown");
        setMessage("暂时无法确认是否改名成功。请读取最新材料状态，不会重复提交。");
      }
    }
  }

  if (!editing) return <button type="button" className="material-title-edit-trigger" onClick={() => setEditing(true)}>修改名称</button>;

  return <div className="material-title-editor">
    <label><span>材料名称</span><input value={title} maxLength={80} disabled={state === "saving" || state === "unknown" || state === "conflict"} onChange={event => changeTitle(event.currentTarget.value)} /></label>
    {message ? <p role="alert">{message}</p> : null}
    <div>
      {state === "unknown" || state === "conflict"
        ? <button type="button" className="secondary-button" onClick={() => router.refresh()}>读取最新名称</button>
        : <button type="button" className="secondary-button" disabled={state === "saving"} onClick={() => void save()}>{state === "saving" ? "正在保存" : "保存名称"}</button>}
      <button type="button" className="material-title-cancel" disabled={state === "saving"} onClick={cancel}>取消</button>
    </div>
  </div>;
}
