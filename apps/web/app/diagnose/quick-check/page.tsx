import { AppShell } from "@/components/app-shell";
import { SyntheticQuickCheck } from "@/components/synthetic-quick-check";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";
import { ProfileSetupRequired } from "@/components/live-today";
import { getCurrentStudentProfile } from "@/lib/student-profile-server";
import { StudentSessionRequiredError } from "@/lib/student-session-server";

export default async function QuickCheckPage() {
  try {
    const { session, profile } = await getCurrentStudentProfile();
    if (!profile.completed) return <ProfileSetupRequired profile={profile}/>;
    return <AppShell actionHref="#quick-check" actionLabel="继续三题检查"><section className="quick-check-page" id="quick-check"><SyntheticQuickCheck studentId={session.studentId}/></section></AppShell>;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    throw error;
  }
}
