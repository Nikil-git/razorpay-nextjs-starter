import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { formatPaise, type PriceBreakdown } from "../lib/format";

/**
 * Checkout page.
 *
 * THE FLOW (and why each step exists):
 *
 *   1. Page loads          -> GET /api/product          (price only, no side effects)
 *   2. Customer clicks Pay -> POST /api/create-order    (server decides the amount)
 *   3. Razorpay modal      -> customer pays
 *   4. handler()           -> POST /api/verify          (proves the payment is real)
 *   5. Show success
 *
 * ⚠️ THIS STARTER HAS NO WEBHOOK.
 *
 * Step 4 proves the payment is genuine, but it is triggered by the browser — a
 * customer can close the tab before it completes, and a malicious client can
 * skip it entirely. Production fulfilment must be driven by a verified webhook
 * that Razorpay delivers regardless of what the browser does.
 *
 * The paid kit adds that webhook, idempotent fulfilment and refunds. Until you
 * add it, treat this as a working demo rather than a production store.
 */

type ApiProduct = {
  product: { id: string; name: string; description: string };
  breakdown: PriceBreakdown;
  currency: string;
  keyId: string;
  testMode: boolean;
};

type Status = "idle" | "processing" | "success" | "failed";

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export const getServerSideProps: GetServerSideProps = async () => {
  // No order is created here. Static shell only.
  return { props: {} };
};

export default function CheckoutPage() {
  const [product, setProduct] = useState<ApiProduct | null>(null);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });


  const PRODUCT_ID = "starter-kit";

  // ---- 1. Load the authoritative price -------------------------------------
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/product?productId=${encodeURIComponent(PRODUCT_ID)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Could not load the product.");
        return data as ApiProduct;
      })
      .then((data) => {
        if (!cancelled) setProduct(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 2-4. Pay ------------------------------------------------------------
  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!customer.name || !customer.email || !customer.phone) {
      setError("Please fill in all details.");
      return;
    }

    setStatus("processing");

    try {
      // The client sends the product id and customer details. NEVER a price.
      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: PRODUCT_ID, customer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start the payment.");

      if (typeof (window as any).Razorpay === "undefined") {
        throw new Error(
          "Razorpay Checkout failed to load. Check your network connection and reload."
        );
      }

      const options = {
        key: data.keyId,
        amount: data.amount, // authoritative, from the server
        currency: data.currency,
        name: "Your Store Name",
        description: product?.product.name ?? "Purchase",
        order_id: data.orderId,
        prefill: {
          name: customer.name,
          email: customer.email,
          contact: customer.phone,
        },
        theme: { color: "#0F3B5E" },
        handler: async (response: RazorpayResponse) => {
          setPaymentId(response.razorpay_payment_id);
          setOrderId(response.razorpay_order_id);
          setStatus("processing");

          try {
            // Prove the payment is genuine before believing it.
            const verifyRes = await fetch("/api/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const verifyData = await verifyRes.json();

            if (!verifyRes.ok || !verifyData?.verified) {
              setStatus("failed");
              setError(
                verifyData?.error ??
                  "We could not verify that payment. No money has been taken."
              );
              return;
            }

            // Signature verified — the payment is genuine.
            // Production would wait for the webhook here instead.
            setStatus("success");
          } catch {
            setStatus("failed");
            setError(
              "We could not verify that payment. If money left your account, contact support with the payment id."
            );
          }
        },
        modal: {
          ondismiss: () => {
            if (status === "processing") {
              setStatus("idle");
            }
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  // ---- Loading / error states ---------------------------------------------
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-gray-800">Checkout unavailable</h1>
          <p className="text-gray-600 mt-2 text-sm">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <p className="text-gray-500">Loading checkout…</p>
      </div>
    );
  }

  const { breakdown, product: info, testMode } = product;

  // ---- Success -------------------------------------------------------------
  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Payment Successful</h1>
          <p className="text-gray-600 mt-2 text-sm">
            A receipt has been sent to {customer.email}.
          </p>
          <div className="mt-4 text-left text-sm space-y-1">
            <p><strong>Payment ID:</strong> {paymentId}</p>
            <p><strong>Order ID:</strong> {orderId}</p>
            <p><strong>Amount:</strong> Rs. {formatPaise(breakdown.total)}</p>
          </div>
          <button
            onClick={() => {
              setStatus("idle");
              setPaymentId("");
              setOrderId("");
              setError("");
            }}
            className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700"
          >
            Pay Again
          </button>
        </div>
      </div>
    );
  }

  // ---- Failed --------------------------------------------------------------
  if (status === "failed") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Payment Failed</h1>
          <p className="text-gray-600 mt-2">{error || "Please try again."}</p>
          {paymentId && (
            <p className="text-xs text-gray-400 mt-2">Payment ID: {paymentId}</p>
          )}
          <button
            onClick={() => {
              setStatus("idle");
              setError("");
            }}
            className="mt-6 bg-blue-600 text-white px-6 py-2 rounded-xl hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ---- Main checkout form --------------------------------------------------
  const busy = status === "processing";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-6xl w-full bg-white rounded-2xl shadow-lg overflow-hidden grid md:grid-cols-5 gap-0">
        <div className="md:col-span-2 bg-gradient-to-br from-blue-900 to-blue-800 p-8 text-white flex flex-col justify-between">
          <div>
            <h2 className="text-2xl font-light mb-2">Razorpay</h2>
            <h1 className="text-3xl font-bold mb-6">Secure Payments</h1>

            {testMode && (
              <div className="mb-4 rounded-lg bg-yellow-400/20 border border-yellow-300/40 px-3 py-2 text-xs">
                <strong>Test mode.</strong> No real money moves. Use a Razorpay
                test card or test UPI id.
              </div>
            )}

            <div className="space-y-4">
              <div>
                <p className="text-sm text-blue-200">Order Summary</p>
                <div className="border-b border-blue-700 py-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold">{info.name}</p>
                      <p className="text-sm text-blue-200">{info.description}</p>
                    </div>
                    <span className="text-lg font-bold">
                      Rs. {formatPaise(breakdown.subtotal)}
                    </span>
                  </div>
                </div>
                <div className="py-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>Rs. {formatPaise(breakdown.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>GST (18%)</span>
                    <span>Rs. {formatPaise(breakdown.tax)}</span>
                  </div>
                </div>
                <div className="border-t border-blue-700 pt-3 flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>Rs. {formatPaise(breakdown.total)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="block text-blue-200">Secure Payments</span>
              <span>Your payment details are protected</span>
            </div>
            <div>
              <span className="block text-blue-200">Instant Activation</span>
              <span>Get access immediately after payment</span>
            </div>
            <div>
              <span className="block text-blue-200">24/7 Support</span>
              <span>We are here to help you anytime</span>
            </div>
          </div>
          <div className="mt-4 text-xs text-blue-300">Powered by Razorpay</div>
        </div>

        <div className="md:col-span-3 p-8 bg-white">
          <h2 className="text-2xl font-bold text-gray-800 mb-1">Complete Your Payment</h2>
          <p className="text-sm text-gray-500 mb-6">
            Choose a payment method and complete your purchase
          </p>

          <form onSubmit={handlePayment} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text"
                value={customer.name}
                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={busy}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={customer.email}
                onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={busy}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <input
                type="tel"
                value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                disabled={busy}
                required
              />
            </div>

            <div className="border-t pt-4">
              <h3 className="font-semibold text-gray-800 mb-2">Recommended</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="border rounded-xl p-3 flex items-center gap-2">
                  <span className="font-medium">Cards</span>
                  <span className="text-xs text-gray-500">Visa, Mastercard, RuPay, Maestro</span>
                </div>
                <div className="border rounded-xl p-3 flex items-center gap-2">
                  <span className="font-medium">UPI</span>
                  <span className="text-xs text-gray-500">Pay using any UPI app</span>
                </div>
                <div className="border rounded-xl p-3 flex items-center gap-2">
                  <span className="font-medium">Netbanking</span>
                  <span className="text-xs text-gray-500">Pay using your preferred bank</span>
                </div>
                <div className="border rounded-xl p-3 flex items-center gap-2">
                  <span className="font-medium">Wallet</span>
                  <span className="text-xs text-gray-500">Pay using digital wallets</span>
                </div>
                <div className="border rounded-xl p-3 flex items-center gap-2 col-span-2">
                  <span className="font-medium">EMI</span>
                  <span className="text-xs text-gray-500">Convert your purchase into easy EMIs</span>
                </div>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Your payment information is encrypted and secure. We do not store your card details.</span>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-blue-800 hover:bg-blue-900 text-white py-4 rounded-xl font-bold text-lg transition disabled:opacity-50"
            >
              {busy ? "Processing…" : `Pay Rs. ${formatPaise(breakdown.total)}`}
            </button>
            <p className="text-xs text-center text-gray-400">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
