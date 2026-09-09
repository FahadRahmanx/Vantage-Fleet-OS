import crypto from "node:crypto";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_BUCKET_NAME;
const configured = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && BUCKET);

const s3 = configured
  ? new S3Client({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    })
  : null;

// In-memory fallback used when AWS isn't configured — mirrors
// services/mailer.ts's json-transport fallback, so dev/test never needs
// real AWS credentials to exercise this feature end-to-end.
const memoryStore = new Map<string, Buffer>();

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * buildKey — the S3 object key (or in-memory store key) for a new upload.
 * Includes a random UUID so two uploads of the same filename never collide.
 */
export function buildKey(loadId: string, fileName: string): string {
  return `loads/${loadId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

export async function uploadDocument(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  if (!s3) {
    memoryStore.set(key, buffer);
    return;
  }
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
}

/**
 * getPresignedUrl — a 15-minute GET URL. In fallback mode, returns a
 * memory:// marker instead of a real URL (only meaningful within the same
 * process — this is the dev/test path, not a real download link).
 */
export async function getPresignedUrl(key: string): Promise<string> {
  if (!s3) {
    return `memory://${key}`;
  }
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 900 });
}

export async function deleteDocument(key: string): Promise<void> {
  if (!s3) {
    memoryStore.delete(key);
    return;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
