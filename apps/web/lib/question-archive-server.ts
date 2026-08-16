import "server-only";

import { QuestionArchiveViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { getCurrentStudentSession } from "./student-session-server";

export async function fetchCurrentStudentQuestionArchive(signal?: AbortSignal) {
  const { session, cookieHeader } = await getCurrentStudentSession();
  return apiServerGet(`/api/v1/students/${session.studentId}/question-archive`, QuestionArchiveViewSchema, signal, { Cookie: cookieHeader });
}
