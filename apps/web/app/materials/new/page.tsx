import { SourceUpload } from "@/components/source-upload";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { parseApiOrigin, parseDemoStudentId, WebConfigurationError } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

function ConfigurationError({ error }: { error: WebConfigurationError }) {
  return <AppShell actionDisabled actionLabel="配置不可用">
    <section className="upload-page" aria-labelledby="upload-config-error" data-config-error={error.code}>
      <div className="title-row"><div>
        <span className="status-chip error">上传暂不可用</span>
        <h1 id="upload-config-error">暂时无法准备上传</h1>
        <p>上传功能暂时没有准备好，请稍后再试。你的学习记录不会因此改变。</p>
      </div></div>
      <article className="state-card"><Icon name="report"/><div>
        <h2>这次没有加载成功</h2>
        <p>请返回今日页，或稍后重新打开上传页面。</p>
      </div></article>
    </section>
  </AppShell>;
}

export default function MaterialsNewPage() {
  try {
    parseApiOrigin(process.env.GAPPROOF_API_ORIGIN);
    return <SourceUpload studentId={parseDemoStudentId(process.env.GAPPROOF_DEMO_STUDENT_ID)}/>;
  } catch (error) {
    if (error instanceof WebConfigurationError) return <ConfigurationError error={error}/>;
    throw error;
  }
}
