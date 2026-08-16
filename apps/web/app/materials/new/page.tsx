import { SourceUpload } from "@/components/source-upload";
import { AppShell } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { parseApiOrigin, WebConfigurationError } from "@/lib/runtime-config";
import { getCurrentStudentSession, StudentSessionRequiredError } from "@/lib/student-session-server";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { fetchRecoverableOcrBatches } from "@/lib/ocr-recovery-server";

export const dynamic = "force-dynamic";

function ConfigurationError({ error }: { error: WebConfigurationError }) {
  return <AppShell actionDisabled actionLabel="配置不可用">
    <section className="upload-page" aria-labelledby="upload-config-error" data-config-error={error.code}>
      <div className="title-row"><div>
        <h1 id="upload-config-error">暂时无法准备上传</h1>
        <p>上传功能暂时没有准备好，请稍后再试。你的学习记录不会因此改变。</p>
      </div></div>
      <article className="state-card"><Icon name="report"/><div>
        <h2>这次没有加载成功</h2>
        <p>请返回今日页，或稍后重新打开上传页面。</p>
        <div className="button-row">
          <Link className="primary-blue" href="/student/today?source=api">返回今日</Link>
          <Link className="ghost-link" href="/materials/new">重新打开上传</Link>
        </div>
      </div></article>
    </section>
  </AppShell>;
}

type PageProps = { searchParams: Promise<{ batch?: string }> };

export default async function MaterialsNewPage({ searchParams }: PageProps) {
  try {
    parseApiOrigin(process.env.GAPPROOF_API_ORIGIN);
    const { session } = await getCurrentStudentSession();
    const { batch: requestedBatchId } = await searchParams;
    const recoverable = (await fetchRecoverableOcrBatches()).data.batches;
    const selectedBatch = recoverable.find(batch => batch.batchId === requestedBatchId);
    return <SourceUpload
      studentId={session.studentId}
      recoverableBatches={recoverable}
      {...(selectedBatch ? { initialBatch: selectedBatch } : {})}
    />;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    if (error instanceof WebConfigurationError) return <ConfigurationError error={error}/>;
    throw error;
  }
}
