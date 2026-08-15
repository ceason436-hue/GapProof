import { describe, expect, it } from "vitest";

import {
  requireUploadDirectory,
  WorkerStartupConfigurationError,
} from "./worker-config.ts";

describe("worker startup configuration", () => {
  it("fails closed when the quality-check storage directory is absent", () => {
    expect(() => requireUploadDirectory(undefined)).toThrow(WorkerStartupConfigurationError);
    expect(() => requireUploadDirectory("   ")).toThrow("GAPPROOF_UPLOAD_DIR must be configured");
  });

  it("trims and returns a configured directory without exposing it in errors", () => {
    expect(requireUploadDirectory("  ./uploads  ")).toBe("./uploads");
    try {
      requireUploadDirectory(undefined);
    } catch (error) {
      expect(error).not.toHaveProperty("message", expect.stringContaining("uploads"));
    }
  });
});
