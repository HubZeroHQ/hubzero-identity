import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomBase64Url(byteLength: number): string {
  return encodeBase64Url(randomBytes(byteLength));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function hmacSha256(value: string, key: Uint8Array, domain: string): string {
  return createHmac("sha256", key).update(domain, "utf8").update("\0").update(value, "utf8").digest("base64url");
}

export function decodeRequiredBase64Key(value: string, name: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength < 32) throw new Error(`${name} must decode to at least 32 bytes`);
  return key;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
