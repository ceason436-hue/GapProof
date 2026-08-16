import "server-only";

import { StudentFactReportsViewSchema, StudentProgressViewSchema } from "@gapproof/contracts";

import { apiServerGet } from "./api-server";
import { getCurrentStudentSession } from "./student-session-server";

export async function fetchCurrentStudentProgress(signal?: AbortSignal) {
  const { session, cookieHeader } = await getCurrentStudentSession();
  return apiServerGet(`/api/v1/students/${session.studentId}/progress`, StudentProgressViewSchema, signal, { Cookie: cookieHeader });
}

export async function fetchCurrentStudentReports(signal?: AbortSignal) {
  const { session, cookieHeader } = await getCurrentStudentSession();
  return apiServerGet(`/api/v1/students/${session.studentId}/reports`, StudentFactReportsViewSchema, signal, { Cookie: cookieHeader });
}
