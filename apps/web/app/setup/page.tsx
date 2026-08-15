import { StudentProfileSetup } from "@/components/student-profile-setup";
import { apiServerGet } from "@/lib/api-server";
import { parseDemoStudentId } from "@/lib/runtime-config";
import { StudentProfileViewSchema } from "@gapproof/contracts";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const studentId = parseDemoStudentId(process.env.GAPPROOF_DEMO_STUDENT_ID);
  const profile = await apiServerGet(`/api/v1/students/${studentId}/profile`, StudentProfileViewSchema);
  return <StudentProfileSetup profile={profile.data} />;
}
