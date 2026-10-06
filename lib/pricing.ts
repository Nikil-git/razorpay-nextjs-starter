/**
 * Product catalogue and price calculation.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR PRICING.
 *
 * Both the order-creation API route and the price-display API route import
 * from here, so the amount shown to the customer and the amount sent to
 * Razorpay can never drift apart. If you change a price, you change it in
 * exactly one place.
 *
 * SERVER-ONLY. Do not import this file from a client component — it would
 * bundle your catalogue into the browser JavaScript. Client components should
 * import from lib/format.ts, which holds only formatting helpers.
 *
 * Razorpay works in the smallest currency unit: for INR that is paise.
 * Rs. 4999.00  ->  499900 paise
 */

import type { PriceBreakdown } from "./format";

export type { PriceBreakdown } from "./format";

export type Product = {
  id: string;
  name: string;
  description: string;
  /** Base price in paise, BEFORE tax. */
  basePrice: number;
  /** Tax rate as a fraction; 0.18 = 18% GST. */
  taxRate: number;
};

export const PRODUCTS: Record<string, Product> = {
  "starter-kit": {
    id: "starter-kit",
    name: "Your Product Name",
    description: "Shown on the checkout summary",
    // Rs.1271.19 + 18% GST = Rs.1500.00 exactly. Change to your own price.
    // For a flat amount with no tax line, set basePrice to the full paise
    // value and taxRate to 0.
    basePrice: 127119, // Rs.1271.19
    taxRate: 0.18, // 18% GST
  },
};

export const DEFAULT_PRODUCT_ID = "starter-kit";
export const CURRENCY = "INR";

/**
 * Computes the authoritative price breakdown for a product.
 *
 * Tax is computed in paise and rounded once, at the end. Rounding in rupees and
 * multiplying afterwards is how you end up charging a different amount than you
 * display.
 */
export function getPriceBreakdown(productId: string): PriceBreakdown {
  const product = PRODUCTS[productId];
  if (!product) {
    throw new Error(`Unknown product: ${productId}`);
  }

  const subtotal = product.basePrice;
  const tax = Math.round(subtotal * product.taxRate);

  return { subtotal, tax, total: subtotal + tax };
}

