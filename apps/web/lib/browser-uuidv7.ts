const UUID_BYTE_LENGTH = 16;
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;

export function createBrowserUuidV7(
  nowMs = Date.now(),
  randomBytes?: Uint8Array,
): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError("UUIDv7 timestamp must be a non-negative 48-bit integer");
  }
  if (randomBytes && randomBytes.length !== UUID_BYTE_LENGTH) {
    throw new RangeError("UUIDv7 randomness must contain exactly 16 bytes");
  }

  const bytes = randomBytes
    ? Uint8Array.from(randomBytes)
    : globalThis.crypto.getRandomValues(new Uint8Array(UUID_BYTE_LENGTH));
  let timestamp = BigInt(nowMs);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
