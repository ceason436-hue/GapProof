import { describe, expect, it } from "vitest";
import { createBrowserUuidV7 } from "./browser-uuidv7";

describe("browser UUIDv7", () => {
  it("encodes the 48-bit timestamp with UUIDv7 version and RFC variant", () => {
    const uuid = createBrowserUuidV7(0x0198b1111111, new Uint8Array(16).fill(0xff));

    expect(uuid).toBe("0198b111-1111-7fff-bfff-ffffffffffff");
    expect(uuid[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });

  it("rejects invalid timestamps and randomness", () => {
    expect(() => createBrowserUuidV7(-1, new Uint8Array(16))).toThrow(RangeError);
    expect(() => createBrowserUuidV7(Date.now(), new Uint8Array(15))).toThrow(RangeError);
  });
});
