/**
 * Order persistence.
 *
 * This kit ships with a dependency-free JSON file store so it runs immediately
 * after `npm install`. The `OrderStore` interface is intentionally small — to
 * move to Postgres/Prisma/MySQL/MongoDB, reimplement these six methods and
 * nothing else in the kit needs to change.
 *
 * Two things here exist specifically to prevent double-fulfilment:
 *
 *   1. `claimForFulfilment()` — an atomic check-and-set. It returns true for
 *      exactly ONE caller per order, no matter how many webhook retries arrive
 *      concurrently.
 *   2. A serialising mutex around read-modify-write, so two simultaneous
 *      requests cannot both read `status: "created"` and both write `paid`.
 *
 * In a real database you would get both of these from a single atomic
 * `UPDATE ... WHERE status = 'created'` and would not need the mutex. The mutex
 * is here because the JSON file store has no such primitive.
 */

import fs from "fs";
import path from "path";

export type OrderStatus = "created" | "paid" | "failed" | "refunded";

export type Order = {
  /** Our internal id (the Razorpay order id, used as the primary key). */
  id: string;
  /** Razorpay order id, e.g. order_XXXXXXXXXXXX. */
  razorpayOrderId: string;
  /** Razorpay payment id, set once a payment attempt resolves. */
  razorpayPaymentId: string | null;
  productId: string;
  status: OrderStatus;

  customer: { name: string; email: string; phone: string };

  /** Amount breakdown in paise. */
  subtotal: number;
  tax: number;
  total: number;
  currency: string;

  /** Set when the order is fulfilled, for auditing. */
  fulfilledAt: string | null;
  failureReason: string | null;
  refundedAmount: number | null;

  createdAt: string;
  updatedAt: string;
};

export type NewOrder = Omit<
  Order,
  | "status"
  | "razorpayPaymentId"
  | "fulfilledAt"
  | "failureReason"
  | "refundedAmount"
  | "createdAt"
  | "updatedAt"
>;

const DB_PATH = path.join(process.cwd(), "data", "orders.json");

/**
 * Serialises read-modify-write cycles within this process.
 *
 * NOTE: this protects against concurrent requests in a single Node process.
 * If you scale to multiple instances, replace this store with a real database
 * and delete the mutex — a database gives you atomicity across processes.
 */
let writeLock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeLock.then(fn, fn);
  // Keep the chain alive even if fn rejects, so one error doesn't poison the queue.
  writeLock = run.catch(() => undefined);
  return run;
}

function readAll(): Order[] {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Order[]) : [];
  } catch {
    return [];
  }
}

function writeAll(orders: Order[]): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  // Write to a temp file then rename: a crash mid-write cannot corrupt the store.
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2), "utf8");
  fs.renameSync(tmp, DB_PATH);
}

export const orderStore = {
  async create(input: NewOrder): Promise<Order> {
    return withLock(async () => {
      const now = new Date().toISOString();
      const order: Order = {
        ...input,
        status: "created",
        razorpayPaymentId: null,
        fulfilledAt: null,
        failureReason: null,
        refundedAmount: null,
        createdAt: now,
        updatedAt: now,
      };
      const all = readAll();
      all.push(order);
      writeAll(all);
      return order;
    });
  },

  async getByRazorpayOrderId(razorpayOrderId: string): Promise<Order | null> {
    return readAll().find((o) => o.razorpayOrderId === razorpayOrderId) ?? null;
  },

  async getByPaymentId(paymentId: string): Promise<Order | null> {
    return readAll().find((o) => o.razorpayPaymentId === paymentId) ?? null;
  },

  async getById(id: string): Promise<Order | null> {
    return readAll().find((o) => o.id === id) ?? null;
  },

  async list(): Promise<Order[]> {
    return readAll();
  },

  /**
   * Attaches a payment id to an order without fulfilling it. Used by
   * /api/verify, which confirms the payment is genuine but leaves fulfilment to
   * the webhook.
   */
  async attachPayment(
    razorpayOrderId: string,
    paymentId: string
  ): Promise<Order | null> {
    return withLock(async () => {
      const all = readAll();
      const order = all.find((o) => o.razorpayOrderId === razorpayOrderId);
      if (!order) return null;
      if (!order.razorpayPaymentId) {
        order.razorpayPaymentId = paymentId;
        order.updatedAt = new Date().toISOString();
        writeAll(all);
      }
      return order;
    });
  },

  /**
   * ATOMIC check-and-set. Returns true for exactly one caller per order.
   *
   * The first caller flips status created -> paid and gets `true`; every
   * subsequent caller gets `false` and must do nothing. This is what makes the
   * webhook handler safe against Razorpay's retries.
   */
  async claimForFulfilment(
    razorpayOrderId: string,
    paymentId: string
  ): Promise<{ claimed: boolean; order: Order | null }> {
    return withLock(async () => {
      const all = readAll();
      const order = all.find((o) => o.razorpayOrderId === razorpayOrderId);
      if (!order) return { claimed: false, order: null };

      if (order.status === "paid" || order.status === "refunded") {
        // Already fulfilled (or refunded). Someone else got here first.
        return { claimed: false, order };
      }

      const now = new Date().toISOString();
      order.status = "paid";
      order.razorpayPaymentId = paymentId;
      order.fulfilledAt = now;
      order.updatedAt = now;
      order.failureReason = null;
      writeAll(all);

      return { claimed: true, order };
    });
  },

  /**
   * Records a failure. Never downgrades an order that is already paid or
   * refunded — out-of-order webhook delivery can otherwise mark a successful
   * payment as failed.
   */
  async markFailed(
    razorpayOrderId: string,
    reason: string
  ): Promise<{ updated: boolean; order: Order | null }> {
    return withLock(async () => {
      const all = readAll();
      const order = all.find((o) => o.razorpayOrderId === razorpayOrderId);
      if (!order) return { updated: false, order: null };

      if (order.status === "paid" || order.status === "refunded") {
        return { updated: false, order };
      }

      order.status = "failed";
      order.failureReason = reason;
      order.updatedAt = new Date().toISOString();
      writeAll(all);
      return { updated: true, order };
    });
  },

  /** Records a refund. Idempotent — replaying the same refund is a no-op. */
  async markRefunded(
    razorpayPaymentId: string,
    amount: number
  ): Promise<{ updated: boolean; order: Order | null }> {
    return withLock(async () => {
      const all = readAll();
      const order = all.find((o) => o.razorpayPaymentId === razorpayPaymentId);
      if (!order) return { updated: false, order: null };

      if (order.status === "refunded" && order.refundedAmount === amount) {
        return { updated: false, order };
      }

      order.status = "refunded";
      order.refundedAmount = amount;
      order.updatedAt = new Date().toISOString();
      writeAll(all);
      return { updated: true, order };
    });
  },
};
