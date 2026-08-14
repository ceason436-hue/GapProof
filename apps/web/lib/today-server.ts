import "server-only";

import { TodayTasksViewSchema } from "@gapproof/contracts";
import { apiServerGet } from "./api-server";
import { parseDemoStudentId } from "./runtime-config";

export function fetchDemoStudentToday(signal?: AbortSignal) {
  const studentId = parseDemoStudentId(process.env.GAPPROOF_DEMO_STUDENT_ID);
  return apiServerGet(`/api/v1/students/${studentId}/today`, TodayTasksViewSchema, signal);
}
