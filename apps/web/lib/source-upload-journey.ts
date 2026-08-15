export type UploadJourneyStatus = "idle" | "hashing" | "creating" | "uploading" | "preparing" | "queued" | "processing" | "needs_confirmation" | "succeeded" | "retryable_error" | "failed" | "timeout" | "error";
export type RecognitionJourneyStatus = "idle" | "starting" | "success" | "error" | "network_unknown";

export function uploadJourneyPosition(status: UploadJourneyStatus, recognitionStatus: RecognitionJourneyStatus): number {
  if (recognitionStatus === "success") return 4;
  if (recognitionStatus === "starting" || recognitionStatus === "error" || recognitionStatus === "network_unknown") return 3;
  if (status === "succeeded") return 3;
  if (["preparing", "queued", "processing", "needs_confirmation", "retryable_error", "failed", "timeout"].includes(status)) return 2;
  if (["hashing", "creating", "uploading", "error"].includes(status)) return 1;
  return 0;
}
