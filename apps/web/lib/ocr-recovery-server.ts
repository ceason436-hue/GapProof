import "server-only";

import { RecoverableOcrBatchesViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { getCurrentStudentSession } from "./student-session-server";

export async function fetchRecoverableOcrBatches(signal?: AbortSignal) {
  const { cookieHeader } = await getCurrentStudentSession();
  return apiServerGet(
    "/api/v1/device-session/ocr-batches",
    RecoverableOcrBatchesViewSchema,
    signal,
    { Cookie: cookieHeader },
  );
}
