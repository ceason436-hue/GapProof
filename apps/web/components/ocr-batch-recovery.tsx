import type { RecoverableOcrBatchView } from "@gapproof/contracts";
import Link from "next/link";

const copy = {
  continue_upload: { title: "有一份材料还没提交识别", detail: "可以继续添加图片，检查无误后再确认开始识别。", action: "继续处理材料" },
  wait: { title: "材料正在识别", detail: "识别服务仍在处理，完成后还需要你核对题目内容。", action: "查看识别进度" },
  review: { title: "识别内容等你核对", detail: "请逐题检查识别内容，确认后才会进入学习检查。", action: "去核对题目" },
  retry: { title: "这份材料需要重新处理", detail: "上次识别没有完成。你可以重新上传图片，或在暂时错误解除后重试。", action: "查看恢复方式" },
} as const;

function href(batch: RecoverableOcrBatchView) {
  if (batch.status === "failed") return "/materials/new";
  return batch.resumeKind === "wait" || batch.resumeKind === "review"
    ? `/materials/${batch.caseId}/review`
    : `/materials/new?batch=${batch.batchId}`;
}

export function OcrBatchRecovery({ batches, compact = false }: { batches: readonly RecoverableOcrBatchView[]; compact?: boolean }) {
  if (batches.length === 0) return null;
  return <section className={`ocr-recovery ${compact ? "compact" : ""}`} aria-labelledby="ocr-recovery-title" data-ocr-recovery-count={batches.length}>
    <header><div><span className="eyebrow">未完成的材料</span><h2 id="ocr-recovery-title">继续上次的检查</h2></div><span>{batches.length} 份</span></header>
    <div className="ocr-recovery-list">{batches.map(batch => {
      const item = copy[batch.resumeKind];
      return <article key={batch.batchId} data-resume-kind={batch.resumeKind}>
        <div><strong>{batch.status === "failed" ? "这份材料没有识别完成" : item.title}</strong><p>{batch.status === "failed" ? "原批次无法继续处理，请重新上传图片。新图片仍会先检查，再由你确认是否开始识别。" : item.detail}</p><small>{batch.pageCount} 张图片</small></div>
        <Link className="secondary-button" href={href(batch)}>{batch.status === "failed" ? "重新上传图片" : item.action}</Link>
      </article>;
    })}</div>
  </section>;
}
