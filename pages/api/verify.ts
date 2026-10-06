/**
 * POST /api/verify
 *
 * Verifies the signature Razorpay Checkout hands back to the browser.
 *
 * Why this endpoint matters: the browser's success callback is just a client
 * saying "it worked". Anyone can open devtools and call it directly. Verifying
 * the HMAC signature against your KEY SECRET proves Razorpay actually produced
 * that (order_id, payment_id) pair.
 *
 * IMPORTANT — this starter has NO webhook, so this route is the only thing
 * confirming the payment. That is a real weakness: it is triggered by the
 * browser, so a customer can close the tab before it completes, and a malicious
 * client can skip it entirely.
 *
 * In production, fulfilment must be driven by a Razorpay webhook, which is
 * delivered regardless of what the browser does. That webhook handler —
 * raw-body verified and idempotent — is in the paid kit, not here.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { orderStore } from "../../lib/db";
import { verifyCheckoutSignature } from "../../lib/razorpay";

type Body = {
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as Body;
  const orderId = (body.razorpay_order_id ?? "").trim();
  const paymentId = (body.razorpay_payment_id ?? "").trim();
  const signature = (body.razorpay_signature ?? "").trim();

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({
      verified: false,
      error: "Missing razorpay_order_id, razorpay_payment_id or razorpay_signature.",
    });
  }

  // Confirm we created this order, so a valid signature from some other order
  // cannot be replayed against this one.
  const order = await orderStore.getByRazorpayOrderId(orderId);
  if (!order) {
    return res.status(404).json({
      verified: false,
      error: "Unknown order.",
    });
  }

  const valid = verifyCheckoutSignature({ orderId, paymentId, signature });

  if (!valid) {
    console.warn("[verify] signature mismatch", { orderId, paymentId });
    return res.status(400).json({
      verified: false,
      error: "Payment verification failed.",
    });
  }

  // Genuine payment. Record the payment id so the UI can show it, but leave
  // status as `created` — the webhook owns the transition to `paid`.
  const updated = await orderStore.attachPayment(orderId, paymentId);

  return res.status(200).json({
    verified: true,
    orderId,
    paymentId,
    // The client uses this to decide between "confirmed" and "confirming".
    status: updated?.status ?? order.status,
  });
}
