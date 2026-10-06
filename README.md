<div align="center">

# Razorpay + Next.js Starter

**Accept Razorpay payments in Next.js the way you're supposed to:**
server-side order creation, HMAC signature verification, no client-trusted prices.

Free and MIT licensed. Works as-is for a simple store.

</div>

---

## What this is

A minimal, correct Razorpay integration for **Next.js 14 (Pages Router)**. Most
tutorials get the basics wrong in ways that cost you money. This one doesn't.

- ✅ **Server-side order creation** — the browser sends a product id, never a price
- ✅ **HMAC SHA256 signature verification** — constant-time comparison, not `===`
- ✅ **One source of truth for pricing** — the displayed total *is* the charged total
- ✅ **Typed, strict TypeScript** — zero errors under `strict: true`
- ✅ **No database needed** — JSON file store, swap it later

### What's NOT in this repo

- ❌ Verified webhook handling (raw-body signature check)
- ❌ Idempotent fulfilment — the guard that stops duplicate deliveries double-shipping
- ❌ Out-of-order event handling
- ❌ Refunds

Those are the hard parts, and they're in the paid kit: **[→ Razorpay + Next.js Payments Kit](https://rzp.io/rzp/48e1FyMD)**

---

## Quick start

```bash
npm install
cp .env.example .env.local   # then add your Razorpay test keys
npm run dev
```

Open http://localhost:3000 → redirected to `/checkout`.

**Test credentials** (Razorpay test mode needs no business verification):

| Method | Value |
|---|---|
| Card | `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234` |
| UPI | `success@razorpay` |
| Failure | `failure@razorpay` |

Get test keys: [Dashboard](https://dashboard.razorpay.com/) → **Account & Settings → API Keys → Generate Test Key**

---

## The three bugs this avoids

### 1. Trusting a client-supplied amount

The classic mistake:

```ts
// ❌ NEVER do this
const { amount } = req.body;                 // user controls this
await razorpay.orders.create({ amount });
```

Open devtools, send `{ amount: 1 }`, buy a ₹5000 product for ₹1.

This repo sends only a `productId` and looks the price up on the server:

```ts
// ✅ lib/pricing.ts is the only place prices live
const price = getPriceBreakdown(productId);   // client has no say
await razorpay.orders.create({ amount: price.total });
```

### 2. Trusting the browser's success callback

`handler()` firing in the browser proves nothing — it's just the client saying it
worked. You must verify the signature:

```ts
// ✅ HMAC SHA256 over `order_id|payment_id` with your KEY SECRET
const expected = crypto
  .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
  .update(`${orderId}|${paymentId}`)
  .digest("hex");

// Constant-time compare. `===` leaks information through timing.
return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
```

### 3. Forgetting that webhooks retry

Razorpay delivers the same `payment.captured` event more than once. Without an
atomic guard you fulfil twice — you ship two licences, get paid once.

**The fix is not in this repo.** It needs a webhook endpoint plus an atomic
check-and-set on your order store. See the paid kit.

---

## Project structure

```
lib/
  pricing.ts     # single source of truth for prices (SERVER-ONLY)
  format.ts      # client-safe formatting helpers
  razorpay.ts    # SDK client + signature verification
  db.ts          # JSON order store
pages/
  checkout.tsx   # checkout UI
  api/
    product.ts      # GET  price breakdown for display
    create-order.ts # POST create the Razorpay order
    verify.ts       # POST verify the checkout signature
```

---

## Going to production

This starter is enough for a simple store, but before you take real money:

- [ ] Add the **webhook handler** — the only reliable fulfilment trigger
- [ ] Make fulfilment **idempotent** — retries are guaranteed, not hypothetical
- [ ] Guard against **out-of-order events** — a late `payment.failed` must not
      downgrade a paid order
- [ ] Replace the **JSON store** if you run more than one instance (it uses a
      single-process mutex)
- [ ] Add **refunds**

Every one of those is covered, with tests, in the paid kit.

---

## Licence

MIT — use it commercially, modify it, ship it. Attribution not required.

---

<div align="center">

### Need the parts that are missing?

Webhook verification, idempotent fulfilment, out-of-order handling and refunds,
already written and verified by **49 automated assertions** — including a
concurrency test where 5 simultaneous webhook deliveries produce exactly one
fulfilment.

**[Razorpay + Next.js Payments Kit →](https://rzp.io/rzp/48e1FyMD)**

₹1500 · Razorpay checkout — UPI, cards, netbanking

</div>
