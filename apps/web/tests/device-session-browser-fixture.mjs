const deviceCookieName = "gapproof_device";
const deviceCookieValue = "fixture-device-session-token";

const sessionEnvelope = studentId => ({
  data: {
    authenticated: true,
    studentId,
    expiresAt: "2026-09-15T00:00:00.000Z",
  },
  requestId: "fixture-device-session-request",
  traceId: "fixture-device-session-trace",
});

export function handleDeviceSessionFixture(request, response, studentId) {
  if (request.method === "GET" && request.url === "/v1/device-session/ocr-batches") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      data: { batches: [] },
      requestId: "fixture-ocr-recovery-request",
      traceId: "fixture-ocr-recovery-trace",
    }));
    return true;
  }

  if (request.url !== "/v1/device-session") return false;

  if (request.method === "GET") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(sessionEnvelope(studentId)));
    return true;
  }

  if (request.method === "POST") {
    response.writeHead(201, {
      "Content-Type": "application/json",
      "Set-Cookie": `${deviceCookieName}=${deviceCookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
    });
    response.end(JSON.stringify(sessionEnvelope(studentId)));
    return true;
  }

  return false;
}

export async function installDeviceSessionCookie(page, webOrigin) {
  await page.context().addCookies([{
    name: deviceCookieName,
    value: deviceCookieValue,
    url: webOrigin,
    httpOnly: true,
    sameSite: "Lax",
  }]);
}
