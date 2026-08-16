import "server-only";

import { Value } from "@sinclair/typebox/value";
import { DeviceSessionViewSchema, type DeviceSessionView } from "@gapproof/contracts";
import { cookies } from "next/headers";

import { ensureContractFormats } from "./contract-formats";
import { parseApiOrigin, serverApiUrl } from "./runtime-config";

export class StudentSessionRequiredError extends Error {
  constructor() {
    super("STUDENT_SESSION_REQUIRED");
    this.name = "StudentSessionRequiredError";
  }
}

export async function getCurrentStudentSession(): Promise<{ session: DeviceSessionView; cookieHeader: string }> {
  const cookie = (await cookies()).get("gapproof_device");
  if (cookie === undefined) throw new StudentSessionRequiredError();
  const cookieHeader = `${cookie.name}=${cookie.value}`;
  const origin = parseApiOrigin(process.env.GAPPROOF_API_ORIGIN);
  const response = await fetch(serverApiUrl(origin, "/api/v1/device-session"), {
    cache: "no-store",
    headers: { Accept: "application/json", Cookie: cookieHeader },
  });
  if (response.status === 401) throw new StudentSessionRequiredError();
  if (!response.ok) throw new Error("STUDENT_SESSION_UNAVAILABLE");
  const payload: unknown = await response.json();
  const data = typeof payload === "object" && payload !== null && "data" in payload
    ? (payload as { data: unknown }).data
    : undefined;
  ensureContractFormats();
  if (!Value.Check(DeviceSessionViewSchema, data)) throw new Error("STUDENT_SESSION_RESPONSE_INVALID");
  return { session: data, cookieHeader };
}
