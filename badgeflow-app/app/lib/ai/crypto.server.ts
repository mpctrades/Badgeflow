// Encrypts merchants' AI provider keys at rest (AES-256-GCM). The key comes
// from BADGEFLOW_ENCRYPTION_KEY (32 bytes, base64) when set; otherwise it is
// derived from SHOPIFY_API_SECRET, so rotating that secret means merchants
// reconnect their AI key. Plaintext keys are never logged or returned to the
// browser.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

let cached: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cached) return cached;
  const explicit = process.env.BADGEFLOW_ENCRYPTION_KEY;
  if (explicit) {
    const key = Buffer.from(explicit, "base64");
    if (key.length !== 32) throw new Error("BADGEFLOW_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    cached = key;
  } else if (process.env.SHOPIFY_API_SECRET) {
    cached = scryptSync(process.env.SHOPIFY_API_SECRET, "badgeflow-ai-key-v1", 32);
  } else {
    throw new Error("No encryption key available for AI keys");
  }
  return cached;
}

// Output: "v1:<iv>:<tag>:<ciphertext>", all base64.
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
