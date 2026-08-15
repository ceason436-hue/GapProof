import { describe, expect, it } from "vitest";

import { inspectImageHeaders } from "./source-asset-inspection.ts";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(15);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes[11] = 1;
  bytes[12] = 1;
  bytes[13] = 0x11;
  bytes[14] = 0;
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes[24] = (width - 1) & 0xff;
  bytes[25] = ((width - 1) >>> 8) & 0xff;
  bytes[26] = (width - 1) >>> 16;
  bytes[27] = (height - 1) & 0xff;
  bytes[28] = ((height - 1) >>> 8) & 0xff;
  bytes[29] = (height - 1) >>> 16;
  return bytes;
}

describe("source asset image header inspection", () => {
  it.each([
    ["image/png", png(1280, 960)],
    ["image/jpeg", jpeg(1280, 960)],
    ["image/webp", webp(1280, 960)],
  ] as const)("accepts %s dimensions", (mimeType, bytes) => {
    expect(inspectImageHeaders(bytes, mimeType)).toEqual({
      status: "passed",
      detectedMimeType: mimeType,
      width: 1280,
      height: 960,
      reasons: [],
      checkerVersion: "image-header-v1",
    });
  });

  it("flags low resolution without calling it OCR", () => {
    expect(inspectImageHeaders(png(639, 480), "image/png")).toMatchObject({
      status: "needs_confirmation",
      reasons: ["low_resolution"],
      width: 639,
      height: 480,
    });
  });

  it("rejects MIME mismatch, invalid bytes, and pixel overflow", () => {
    expect(inspectImageHeaders(png(1280, 960), "image/jpeg")).toMatchObject({
      status: "failed",
      reasons: ["mime_mismatch"],
    });
    expect(inspectImageHeaders(Buffer.from([137, 80, 78, 71]), "image/png")).toMatchObject({
      status: "failed",
      reasons: ["invalid_or_truncated_image"],
    });
    expect(inspectImageHeaders(png(10000, 10001), "image/png")).toMatchObject({
      status: "failed",
      reasons: ["pixel_limit_exceeded"],
    });
  });
});
