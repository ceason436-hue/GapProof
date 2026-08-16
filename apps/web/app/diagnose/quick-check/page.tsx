import { AppShell } from "@/components/app-shell";
import { SyntheticQuickCheck } from "@/components/synthetic-quick-check";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { getCurrentStudentSession, StudentSessionRequiredError } from "@/lib/student-session-server";

export default async function QuickCheckPage() {
  try {
    const { session } = await getCurrentStudentSession();
    return <AppShell actionHref="#quick-check" actionLabel="继续三题检查"><section className="quick-check-page" id="quick-check"><SyntheticQuickCheck studentId={session.studentId}/></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    throw error;
  }
}
