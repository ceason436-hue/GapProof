"use client";

import { StudentProfileViewSchema, type StudentProfileView } from "@gapproof/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiClientError, apiRequest } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { isCompleteProfileForm, profileSetupInitialValues, type StudentProfileForm } from "@/lib/student-profile-form";
import { Icon } from "./icons";

const choices = {
  grade: [["7", "七年级"], ["8", "八年级"], ["9", "九年级"]],
  subject: [["english", "英语"]],
  term: [["first_term", "上学期"], ["second_term", "下学期"]],
  region: [["shanghai", "上海"]],
  learningState: [["starting", "刚开始学"], ["catching_up", "正在补基础"], ["steady", "正在稳定学习"]],
} as const;

type StudentProfileSetupProps = {
  profile: StudentProfileView;
  variant?: "standalone" | "today";
};

export function StudentProfileSetup({ profile, variant = "standalone" }: StudentProfileSetupProps) {
  const router = useRouter();
  const [form, setForm] = useState<StudentProfileForm>(() => profileSetupInitialValues(profile));
  const [version, setVersion] = useState(profile.version);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const remainingCount = useMemo(() => Object.values(form).filter((value) => value === "").length, [form]);
  const completedCount = 5 - remainingCount;
  const isToday = variant === "today";

  const change = <K extends keyof StudentProfileForm>(key: K, value: StudentProfileForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function save() {
    if (!isCompleteProfileForm(form)) {
      setStatus("error");
      setMessage("请完成每一项选择后再保存。");
      return;
    }
    setStatus("saving");
    setMessage("");
    try {
      const response = await apiRequest(`/api/v1/students/${profile.studentId}/profile`, StudentProfileViewSchema, {
        method: "PUT",
        body: { expectedVersion: version, ...form },
        idempotencyKey: createBrowserUuidV7(),
      });
      setVersion(response.data.version);
      router.push("/student/today?source=api");
      router.refresh();
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof ApiClientError && error.response.error.code === "VERSION_CONFLICT"
        ? "资料刚刚被更新，请刷新页面后再保存。"
        : "暂时没有保存成功。请检查网络后重试。");
    }
  }

  const panel = <section className={`setup-panel ${isToday ? "setup-panel-embedded" : ""}`} aria-labelledby="setup-title" data-profile-setup={variant}>
      <header className="setup-heading">
        <div className="setup-heading-copy"><p className="eyebrow"><i aria-hidden="true" />{profile.completed ? "学习设置" : "开始前 · 约 1 分钟"}</p>
          <h1 id="setup-title">{profile.completed ? "修改学习范围" : "先确定你的学习范围"}</h1>
          <p>{profile.completed ? "按现在的学习情况重新选择，接下来的内容会使用新范围。" : "告诉我们你现在学到哪里，接下来先从适合你的内容开始。之后可以随时修改。"}</p>
        </div>
        <div className="setup-progress-block">
          <div className="setup-progress-copy"><span aria-live="polite">{remainingCount === 0 ? "已完成选择" : `还需选择 ${remainingCount} 项`}</span><strong>{completedCount} / 5</strong></div>
          <div className="setup-progress-track" aria-hidden="true"><i style={{ width: `${completedCount * 20}%` }} /></div>
          <small>{remainingCount === 0 ? "可以开始了" : "每一项都由你确认"}</small>
        </div>
      </header>
      <div className="setup-body">
        <div className="setup-fields">
          <Choice step={1} label="你现在读几年级？" value={form.grade} choices={choices.grade} onChange={(value) => change("grade", value as StudentProfileForm["grade"])} />
          <Choice step={2} label="这次主要学习什么？" value={form.subject} choices={choices.subject} onChange={(value) => change("subject", value as StudentProfileForm["subject"])} />
          <Choice step={3} label="现在是哪个学期？" value={form.term} choices={choices.term} onChange={(value) => change("term", value as StudentProfileForm["term"])} />
          <Choice step={4} label="你在哪个地区学习？" value={form.region} choices={choices.region} onChange={(value) => change("region", value as StudentProfileForm["region"])} />
          <Choice step={5} label="哪种描述更接近你现在的状态？" value={form.learningState} choices={choices.learningState} onChange={(value) => change("learningState", value as StudentProfileForm["learningState"])} />
        </div>
      </div>
      <div className="setup-actions">
        <div>{message ? <p className="form-error" role="alert">{message}</p> : <p className="setup-action-note">{remainingCount === 0 ? "确认后就可以开始第一次学习检查。" : "选完全部内容后即可确认。"}</p>}</div>
        <button className="primary-blue" type="button" onClick={() => void save()} disabled={status === "saving" || remainingCount > 0}>
          {status === "saving" ? "正在保存" : profile.completed ? "保存修改" : "确认并开始"}{status !== "saving" ? <Icon name="arrow" /> : null}
        </button>
        {profile.completed ? <Link className="secondary-button" href="/student/today?source=api">取消并返回今日</Link> : null}
      </div>
    </section>;

  return isToday ? panel : <main className="setup-page">{panel}</main>;
}

function Choice({ step, label, value, choices: options, onChange }: { step: number; label: string; value: string; choices: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <fieldset className="setup-choice" data-complete={value !== ""}><legend><span className="setup-step">{String(step).padStart(2, "0")}</span><span>{label}</span><span className="setup-choice-state">{value ? "已选" : "待选"}</span></legend><div className="setup-options">{options.map(([optionValue, optionLabel]) => <button
    aria-pressed={value === optionValue}
    className={value === optionValue ? "selected" : ""}
    key={optionValue}
    onClick={() => onChange(optionValue)}
    type="button"
  >{optionLabel}</button>)}</div></fieldset>;
}
