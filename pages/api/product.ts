/**
 * GET /api/product?productId=starter-kit
 *
 * Returns the display name and authoritative price breakdown so the checkout
 * page can render the correct total BEFORE the customer clicks Pay.
 *
 * Side-effect free: unlike the original implementation, loading the checkout
 * page does not create a Razorpay order. Orders are created only when the
 * customer actually submits the form, so refreshing the page no longer litters
 * your dashboard with orphaned orders.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import {
  CURRENCY,
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  getPriceBreakdown,
} from "../../lib/pricing";
import { isTestMode } from "../../lib/razorpay";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const raw = req.query.productId;
  const productId = (Array.isArray(raw) ? raw[0] : raw) ?? DEFAULT_PRODUCT_ID;

  const product = PRODUCTS[productId];
  if (!product) {
    return res.status(404).json({ error: `Unknown product: ${productId}` });
  }

  return res.status(200).json({
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
    },
    breakdown: getPriceBreakdown(productId),
    currency: CURRENCY,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID ?? "",
    testMode: isTestMode,
  });
}
