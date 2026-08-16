import { StudentProfileViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { getCurrentStudentSession } from "./student-session-server";

export async function getCurrentStudentProfile() {
  const { session, cookieHeader } = await getCurrentStudentSession();
  const response = await apiServerGet(
    `/api/v1/students/${session.studentId}/profile`,
    StudentProfileViewSchema,
    undefined,
    { Cookie: cookieHeader },
  );
  return { session, cookieHeader, profile: response.data };
}
