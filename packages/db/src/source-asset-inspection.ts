import type {
  SourceAssetQualityCheck,
} from "@gapproof/contracts";

type StudentUploadMimeType = "image/jpeg" | "image/png" | "image/webp";

const MAX_PIXELS = 100_000_000;
const CHECKER_VERSION = "image-header-v1" as const;
type Dimensions = { readonly width: number; readonly height: number };

function pngDimensions(bytes: Buffer): Dimensions | null {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (length < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): Dimensions | null {
  if (
    bytes.length < 16 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 > bytes.length
  ) return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + length > bytes.length) return null;
    if (chunk === "VP8X" && length >= 10) {
      return {
        width: 1 + bytes.readUIntLE(data + 4, 3),
        height: 1 + bytes.readUIntLE(data + 7, 3),
      };
    }
    if (chunk === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return { width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff };
    }
    if (chunk === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const bits = bytes.readUInt32LE(data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    offset = data + length + (length % 2);
  }
  return null;
}

function detectedMime(bytes: Buffer): StudentUploadMimeType | null {
  if (pngDimensions(bytes) !== null) return "image/png";
  if (jpegDimensions(bytes) !== null) return "image/jpeg";
  if (webpDimensions(bytes) !== null) return "image/webp";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function dimensionsFor(mime: StudentUploadMimeType, bytes: Buffer): Dimensions | null {
  return mime === "image/png" ? pngDimensions(bytes) : mime === "image/jpeg" ? jpegDimensions(bytes) : webpDimensions(bytes);
}

export function inspectImageHeaders(
  bytes: Buffer,
  declaredMimeType: StudentUploadMimeType,
): SourceAssetQualityCheck {
  const detectedMimeType = detectedMime(bytes);
  const reasons: SourceAssetQualityCheck["reasons"] = [];
  if (detectedMimeType === null) {
    return { status: "failed", detectedMimeType: null, width: null, height: null, reasons: ["invalid_or_truncated_image"], checkerVersion: CHECKER_VERSION };
  }
  if (detectedMimeType !== declaredMimeType) reasons.push("mime_mismatch");
  const dimensions = dimensionsFor(detectedMimeType, bytes);
  if (dimensions === null || dimensions.width < 1 || dimensions.height < 1) {
    reasons.push("invalid_or_truncated_image");
    return { status: "failed", detectedMimeType, width: null, height: null, reasons, checkerVersion: CHECKER_VERSION };
  }
  if (dimensions.width * dimensions.height > MAX_PIXELS) reasons.push("pixel_limit_exceeded");
  if (reasons.length > 0) {
    return { status: "failed", detectedMimeType, width: dimensions.width, height: dimensions.height, reasons, checkerVersion: CHECKER_VERSION };
  }
  if (dimensions.width < 640 || dimensions.height < 480) reasons.push("low_resolution");
  return { status: reasons.length > 0 ? "needs_confirmation" : "passed", detectedMimeType, width: dimensions.width, height: dimensions.height, reasons, checkerVersion: CHECKER_VERSION };
}
