"use client";

import Link from "next/link";
import { useState } from "react";

export type DemoReviewMode = "review" | "empty" | "error";

export const DEMO_REVIEW_ITEM = {
  id: "demo-item-1",
  prompt: "Choose the correct past participle: She has ___ her homework.",
  studentAnswer: "writed",
} as const;

export function validateDemoReviewDraft(prompt: string, studentAnswer: string): string | null {
  if (!prompt.trim() || !studentAnswer.trim()) return "请补充题干和学生答案后再确认。";
  return null;
}

function DemoMaterialPreview() {
  return <div className="demo-paper" role="img" aria-label="合成材料预览，不是真实学生材料">
    <div className="demo-paper-top"><span>ENGLISH PRACTICE</span><span>演示材料</span></div>
    <div className="demo-paper-rule" />
    <p className="demo-paper-kicker">Grammar · Present perfect</p>
    <p className="demo-paper-question">Choose the correct past participle:</p>
    <p className="demo-paper-question">She has <span className="demo-paper-answer">writed</span> her homework.</p>
    <div className="demo-paper-mark" aria-hidden="true">?</div>
    <div className="demo-paper-lines"><span /><span /><span /></div>
    <p className="demo-paper-footer">预置演示页 · 仅用于展示确认交互</p>
  </div>;
}

function ReviewLinks() {
  return <div className="demo-review-links">
    <Link className="ghost-link" href="/materials/new">返回重新上传</Link>
    <Link className="ghost-link" href="/student/today">返回今日</Link>
  </div>;
}

function DemoBanner() {
  return <div className="demo-review-banner" data-demo-banner="synthetic" role="note">
    <strong>演示识别 · 合成材料 · 不是真实学生数据</strong>
    <span data-demo-prebuilt="true">预置识别结果 / 演示回退</span>
  </div>;
}

export function DemoRecognitionReview({ mode = "review" }: { mode?: DemoReviewMode }) {
  const [prompt, setPrompt] = useState<string>(DEMO_REVIEW_ITEM.prompt);
  const [studentAnswer, setStudentAnswer] = useState<string>(DEMO_REVIEW_ITEM.studentAnswer);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const confirm = () => {
    const validationMessage = validateDemoReviewDraft(prompt, studentAnswer);
    if (validationMessage) {
      setFeedback(validationMessage);
      return;
    }
    setConfirmed(true);
    setFeedback("演示确认已记录，仅用于本次演示。不会进入分析，也不会生成学习结论。 ");
  };

  return <section className="demo-review-page" aria-labelledby="demo-review-title">
    <DemoBanner />
    <div className="demo-review-heading">
      <div>
        <p className="eyebrow">识别结果确认</p>
        <h1 id="demo-review-title">确认图片中的内容</h1>
        <p>请检查预置结果，再决定是否在本次演示中确认。真实材料会在后续接入正式流程。</p>
      </div>
      <span className="demo-review-status">本地演示 · 不写入记录</span>
    </div>

    {mode === "empty" ? <article className="demo-review-state" data-review-state="empty">
      <span className="demo-review-state-label">没有待确认内容</span>
      <h2>暂时没有可确认的演示结果</h2>
      <p>这次演示没有提供可编辑内容。可以返回重新上传，或回到今日。</p>
      <ReviewLinks />
    </article> : mode === "error" ? <article className="demo-review-state demo-review-state-error" data-review-state="error">
      <span className="demo-review-state-label">演示内容暂时不可用</span>
      <h2>当前演示内容无法显示</h2>
      <p role="alert">没有写入任何记录。请重新打开演示，或返回今日。</p>
      <ReviewLinks />
    </article> : <>
      <div className="demo-review-grid">
        <article className="demo-review-panel demo-preview-panel">
          <div className="demo-review-panel-heading"><div><span>材料预览</span><h2>一张合成练习页</h2></div><span className="demo-panel-tag">合成</span></div>
          <DemoMaterialPreview />
          <p className="demo-review-note">这是预置演示材料，不代表真实学生作答。</p>
        </article>
        <article className="demo-review-panel demo-form-panel">
          <div className="demo-review-panel-heading"><div><span>识别到的内容</span><h2>请确认这一处结果</h2></div><span className="demo-panel-tag demo-panel-tag-warn">请确认</span></div>
          <div className="demo-review-fields">
            <div className="demo-review-field">
              <label htmlFor="demo-prompt">题干 <span className="demo-field-hint">请确认</span></label>
              <textarea id="demo-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} disabled={confirmed} rows={4} />
            </div>
            <div className="demo-review-field">
              <label htmlFor="demo-student-answer">学生答案 <span className="demo-field-hint">请确认</span></label>
              <input id="demo-student-answer" value={studentAnswer} onChange={event => setStudentAnswer(event.target.value)} disabled={confirmed} />
            </div>
          </div>
          <p className="demo-review-helper">不确定的字段需要你手动检查；这里不展示评分或其他答案信息。</p>
          {confirmed ? <p className="demo-review-confirmed" data-review-state="confirmed"><strong>由用户确认</strong><span>{feedback}</span></p> : <>
            <button className="demo-review-primary" data-demo-confirm="true" type="button" onClick={confirm}>演示确认内容</button>
            {feedback ? <p className="demo-review-form-error" role="alert">{feedback}</p> : null}
          </>}
          <ReviewLinks />
        </article>
      </div>
      <p className="demo-review-live" aria-live="polite">{confirmed ? feedback : "当前有 1 处内容需要确认。"}</p>
    </>}
  </section>;
}
