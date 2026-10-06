/**
 * Formatting helpers safe to import from client components.
 *
 * This file must stay free of secrets and of the product catalogue. Anything
 * imported by pages/checkout.tsx is bundled into the browser JavaScript, so
 * keeping server-only data out of here is what prevents the catalogue and any
 * future pricing logic from leaking into a client bundle.
 */

/** A price breakdown, in paise. Produced server-side by lib/pricing.ts. */
export type PriceBreakdown = {
  subtotal: number;
  tax: number;
  total: number;
};

/** Formats paise as a rupee string, e.g. 589882 -> "5898.82". */
export function formatPaise(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Converts a whole-rupee amount to paise. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
