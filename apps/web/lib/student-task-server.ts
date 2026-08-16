import { LearningTaskViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { getCurrentStudentProfile } from "./student-profile-server";

export async function fetchCurrentStudentTask(taskId: string) {
  const { cookieHeader, profile } = await getCurrentStudentProfile();
  const response = await apiServerGet(
    `/api/v1/tasks/${taskId}`,
    LearningTaskViewSchema,
    undefined,
    { Cookie: cookieHeader },
  );
  return { task: response.data, timeZone: profile.timeZone };
}
