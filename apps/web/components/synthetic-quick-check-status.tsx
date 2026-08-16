"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readSyntheticQuickCheckResult, type StoredSyntheticQuickCheck } from "@/lib/synthetic-quick-check-storage";

const findingLabels: Record<StoredSyntheticQuickCheck["finding"], string> = {
  irregular_participle: "不规则过去分词",
  past_tense: "一般过去时",
  passive_voice: "被动语态",
  mixed_review: "混合复习",
};

export function SyntheticQuickCheckStatus({ studentId }: { studentId: string }) {
  const [result, setResult] = useState<StoredSyntheticQuickCheck | null>(null);

  useEffect(() => {
    setResult(readSyntheticQuickCheckResult(studentId));
  }, [studentId]);

  if (!result) return null;

  return <article className="synthetic-quick-check-status" data-synthetic-quick-check-status>
    <div className="synthetic-quick-check-status-copy">
      <span className="status-chip synthetic-quick-check-status-label">已完成三题快速检查</span>
      <p>{result.correctCount} / {result.totalCount} 题正确 · 本次提示：{findingLabels[result.finding]}</p>
      <small>这是原创体验结果，不会写入正式学习记录、报告或掌握度。</small>
    </div>
    <div className="synthetic-quick-check-status-actions">
      <Link className="primary-blue" href="/materials/new">上传自己的错题继续</Link>
      <Link className="secondary-button" href="/diagnose/quick-check">重新做三题</Link>
    </div>
  </article>;
}
