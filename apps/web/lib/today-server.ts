import "server-only";

import { TodayTasksViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { getCurrentStudentSession } from "./student-session-server";

export async function fetchCurrentStudentToday(signal?: AbortSignal) {
  const { session, cookieHeader } = await getCurrentStudentSession();
  return fetchStudentToday(session.studentId, cookieHeader, signal);
}

export function fetchStudentToday(studentId: string, cookieHeader: string, signal?: AbortSignal) {
  return apiServerGet(`/api/v1/students/${studentId}/today`, TodayTasksViewSchema, signal, { Cookie: cookieHeader });
}
