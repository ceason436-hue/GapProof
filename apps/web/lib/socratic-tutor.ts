import { TutorSessionViewSchema, TutorTurnViewSchema, type CreateTutorTurnRequest } from "@gapproof/contracts";
import { apiGet, apiPost } from "./api-client";

export function submitTutorTurn(taskId: string, body: CreateTutorTurnRequest, idempotencyKey: string) {
  return apiPost(`/api/v1/tasks/${taskId}/tutor-turns`, TutorTurnViewSchema, body, idempotencyKey);
}

export function getTutorSession(taskId: string) {
  return apiGet(`/api/v1/tasks/${taskId}/tutor-session`, TutorSessionViewSchema);
}
