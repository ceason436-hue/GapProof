import { describe, expect, it } from "vitest";
import { uploadJourneyPosition } from "./source-upload-journey";

describe("upload journey position", () => {
  it("makes selection, inspection and case creation visibly distinct", () => {
    expect(uploadJourneyPosition("idle", "idle")).toBe(0);
    expect(uploadJourneyPosition("uploading", "idle")).toBe(1);
    expect(uploadJourneyPosition("processing", "idle")).toBe(2);
    expect(uploadJourneyPosition("succeeded", "idle")).toBe(3);
    expect(uploadJourneyPosition("succeeded", "success")).toBe(4);
  });
});
