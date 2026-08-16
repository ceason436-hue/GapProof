import { StudentProfileSetup } from "@/components/student-profile-setup";
import { apiServerGet } from "@/lib/api-server";
import { StudentProfileViewSchema } from "@gapproof/contracts";
import { getCurrentStudentSession, StudentSessionRequiredError } from "@/lib/student-session-server";
import { StudentSessionBootstrap } from "@/components/student-session-bootstrap";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  try {
    const { session, cookieHeader } = await getCurrentStudentSession();
    const profile = await apiServerGet(`/api/v1/students/${session.studentId}/profile`, StudentProfileViewSchema, undefined, { Cookie: cookieHeader });
    return <StudentProfileSetup profile={profile.data} />;
  } catch (error) {
    if (error instanceof StudentSessionRequiredError) return <StudentSessionBootstrap/>;
    throw error;
  }
}
