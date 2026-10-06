/**
 * Razorpay server-side client and signature verification helpers.
 *
 * SECURITY: everything in this file is server-only. It reads RAZORPAY_KEY_SECRET,
 * which must never be exposed to the browser. Never import this file from a
 * component that renders on the client.
 */

import crypto from "crypto";
import Razorpay from "razorpay";

export const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
export const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

export const isTestMode = KEY_ID.startsWith("rzp_test_");

/**
 * Throws a clear error at startup rather than producing a confusing 401 later.
 */
export function assertRazorpayConfigured(): void {
  const missing: string[] = [];
  if (!KEY_ID) missing.push("RAZORPAY_KEY_ID");
  if (!KEY_SECRET) missing.push("RAZORPAY_KEY_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env.local and fill them in.`
    );
  }
}

let client: Razorpay | null = null;

/**
 * Returns a memoised Razorpay client. Uses the `key_id`/`key_secret` form so it
 * works across razorpay SDK v2.x.
 */
export function getRazorpayClient(): Razorpay {
  assertRazorpayConfigured();
  if (!client) {
    client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return client;
}

/**
 * Constant-time string comparison. Using `===` on signatures leaks information
 * through timing differences; crypto.timingSafeEqual does not.
 *
 * Returns false (rather than throwing) if lengths differ, since
 * timingSafeEqual throws on mismatched buffer lengths.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the signature returned by Razorpay Checkout to the browser.
 *
 * Razorpay signs `${order_id}|${payment_id}` with your KEY SECRET.
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { orderId, paymentId, signature } = params;
  if (!orderId || !paymentId || !signature || !KEY_SECRET) return false;

  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return safeCompare(expected, signature);
}

/**
 * Verifies the `x-razorpay-signature` header on an incoming webhook.
 *
 * Razorpay signs the RAW request body with your WEBHOOK SECRET (a different
 * value from the key secret).
 *
 * You MUST pass the raw, unparsed body. If you JSON.parse() first and
 * re-stringify, key order and whitespace change and the signature will never
 * match. In the Pages Router that means `rawBody` from
 * `micro`/`bodyParser: false`, or `await readRawBody(req)` as used in this kit.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | string[] | undefined
): boolean {
  if (!WEBHOOK_SECRET) return false;
  if (!signatureHeader) return false;

  const signature = Array.isArray(signatureHeader)
    ? signatureHeader[0]
    : signatureHeader;

  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return safeCompare(expected, signature);
}

/** Reads a request stream without parsing it. Required for webhook verification. */
export async function readRawBody(
  stream: NodeJS.ReadableStream
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
