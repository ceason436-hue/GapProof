"use client";

import { StudentProfileViewSchema, type StudentProfileView } from "@gapproof/contracts";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { ApiClientError, apiRequest } from "@/lib/api-client";
import { createBrowserUuidV7 } from "@/lib/browser-uuidv7";
import { isCompleteProfileForm, profileSetupInitialValues, type StudentProfileForm } from "@/lib/student-profile-form";

const choices = {
  grade: [["7", "七年级"], ["8", "八年级"], ["9", "九年级"]],
  subject: [["english", "英语"]],
  term: [["first_term", "上学期"], ["second_term", "下学期"]],
  region: [["shanghai", "上海"]],
  learningState: [["starting", "刚开始学"], ["catching_up", "正在补基础"], ["steady", "正在稳定学习"]],
} as const;

export function StudentProfileSetup({ profile }: { profile: StudentProfileView }) {
  const router = useRouter();
  const [form, setForm] = useState<StudentProfileForm>(() => profileSetupInitialValues(profile));
  const [version, setVersion] = useState(profile.version);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

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

  return <main className="setup-page">
    <section className="setup-panel" aria-labelledby="setup-title">
      <p className="eyebrow">开始前</p>
      <h1 id="setup-title">先选一下你的学习范围</h1>
      <p>这些信息只用来确定本次学习内容的范围；之后可以修改。</p>
      <div className="setup-fields">
        <Choice label="年级" value={form.grade} choices={choices.grade} onChange={(value) => change("grade", value as StudentProfileForm["grade"])} />
        <Choice label="学科" value={form.subject} choices={choices.subject} onChange={(value) => change("subject", value as StudentProfileForm["subject"])} />
        <Choice label="学期" value={form.term} choices={choices.term} onChange={(value) => change("term", value as StudentProfileForm["term"])} />
        <Choice label="学习地区" value={form.region} choices={choices.region} onChange={(value) => change("region", value as StudentProfileForm["region"])} />
        <Choice label="目前的学习状态" value={form.learningState} choices={choices.learningState} onChange={(value) => change("learningState", value as StudentProfileForm["learningState"])} />
      </div>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="primary-blue" type="button" onClick={() => void save()} disabled={status === "saving"}>
        {status === "saving" ? "正在保存" : "保存并开始"}
      </button>
    </section>
  </main>;
}

function Choice({ label, value, choices: options, onChange }: { label: string; value: string; choices: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="setup-choice"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="" disabled>请选择</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>;
}
