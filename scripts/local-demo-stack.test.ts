import { describe, expect, it } from "vitest";

import { buildDemoEnvironment, createLocalDemoConfig, parsePort } from "./local-demo-stack.ts";

describe("local Demo stack configuration", () => {
  it("uses deterministic local defaults without secrets", () => {
    const config = createLocalDemoConfig({}, "C:/workspace");
    expect(config.apiPort).toBe(4000);
    expect(config.webPort).toBe(3000);
    expect(config.apiOrigin).toBe("http://127.0.0.1:4000");
    expect(config.databaseUrl).toBe("postgres://gapproof:gapproof_local@127.0.0.1:55432/gapproof");
    expect(config.studentId).toBe("0198b111-1111-7000-8000-0000000000d2");
    expect(config.uploadDirectory).toBe("C:\\workspace\\.local\\gapproof\\uploads");
  });

  it("honors port and database overrides and rejects collisions", () => {
    const config = createLocalDemoConfig({ API_PORT: "4100", WEB_PORT: "3100", DATABASE_URL: "postgres://local" }, "C:/workspace");
    expect(config.apiPort).toBe(4100);
    expect(config.webPort).toBe(3100);
    expect(config.databaseUrl).toBe("postgres://local");
    expect(() => createLocalDemoConfig({ API_PORT: "4000", WEB_PORT: "4000" })).toThrow("different");
    expect(() => parsePort("70000", 3000, "WEB_PORT")).toThrow("between 1 and 65535");
  });

  it("injects runtime settings while keeping the secret out of logs", () => {
    const config = createLocalDemoConfig({}, "C:/workspace");
    const env = buildDemoEnvironment({ PATH: "test" }, config, "development-only-secret");
    expect(env.GAPPROOF_API_ORIGIN).toBe(config.apiOrigin);
    expect(env.GAPPROOF_DEMO_STUDENT_ID).toBe(config.studentId);
    expect(env.GAPPROOF_ALLOWED_DEV_ORIGINS).toContain("localhost");
    expect(env.GAPPROOF_UPLOAD_SIGNING_SECRET).toBe("development-only-secret");
  });
});
