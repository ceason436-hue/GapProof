import { SourceUpload } from "@/components/source-upload";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { parseApiOrigin, parseDemoStudentId, WebConfigurationError } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";

function ConfigurationError({ error }: { error: WebConfigurationError }) {
  return <AppShell actionDisabled actionLabel="配置不可用">
    <section className="upload-page" aria-labelledby="upload-config-error">
      <div className="title-row"><div>
        <span className="status-chip error">真实上传不可用</span>
        <h1 id="upload-config-error">暂时无法准备上传</h1>
        <p>服务端没有提供有效的 API 或 Demo 学生配置；页面不会创建学生，也不会回退到 Mock。</p>
      </div></div>
      <article className="state-card"><Icon name="report"/><div>
        <h2>请先补齐服务端配置</h2>
        <p>确认 GAPPROOF_API_ORIGIN 与 GAPPROOF_DEMO_STUDENT_ID 有效后再重新加载。</p>
        <div className="config-detail">{error.code}</div>
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
