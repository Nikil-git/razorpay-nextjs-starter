/**
 * POST /api/create-order
 *
 * Creates a Razorpay order server-side.
 *
 * The client sends ONLY a productId. It never sends a price. The amount is
 * looked up from lib/pricing.ts, so a user editing the request in devtools
 * cannot change what they are charged.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { getRazorpayClient, isTestMode, assertRazorpayConfigured } from "../../lib/razorpay";
import { orderStore } from "../../lib/db";
import {
  CURRENCY,
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  getPriceBreakdown,
} from "../../lib/pricing";

type Body = {
  productId?: string;
  customer?: { name?: string; email?: string; phone?: string };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    assertRazorpayConfigured();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server misconfigured";
    return res.status(500).json({ error: message });
  }

  const body = (req.body ?? {}) as Body;

  const productId = body.productId ?? DEFAULT_PRODUCT_ID;
  if (!PRODUCTS[productId]) {
    return res.status(400).json({ error: `Unknown product: ${productId}` });
  }

  const name = (body.customer?.name ?? "").trim();
  const email = (body.customer?.email ?? "").trim();
  const phone = (body.customer?.phone ?? "").trim();

  if (!name || !email || !phone) {
    return res
      .status(400)
      .json({ error: "Name, email and phone are all required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  // Server-side price lookup. The client has no say in the amount.
  const price = getPriceBreakdown(productId);

  try {
    const razorpay = getRazorpayClient();

    const order = await razorpay.orders.create({
      // `total` already includes tax and is what the customer was shown.
      amount: price.total,
      currency: CURRENCY,
      receipt: `rcpt_${Date.now()}`,
      notes: {
        productId,
        customerName: name,
        customerEmail: email,
      },
    });

    await orderStore.create({
      id: order.id,
      razorpayOrderId: order.id,
      productId,
      customer: { name, email, phone },
      subtotal: price.subtotal,
      tax: price.tax,
      total: price.total,
      currency: CURRENCY,
    });

    return res.status(200).json({
      orderId: order.id,
      amount: price.total,
      currency: CURRENCY,
      breakdown: price,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID,
      testMode: isTestMode,
    });
  } catch (err) {
    // Never leak the raw SDK/network error to the client.
    console.error("[create-order] failed:", err);
    return res.status(502).json({
      error:
        "Could not reach the payment gateway. Please try again in a moment.",
    });
  }
}
