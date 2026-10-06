import "../styles/globals.css";
import type { AppProps } from "next/app";
import Script from "next/script";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      {/*
        Razorpay Checkout.js is loaded once, app-wide.
        Loading it here (rather than conditionally inside the page) means the
        checkout page can render immediately instead of blanking itself until
        the script finishes downloading.
      */}
      <Script
        id="razorpay-checkout-js"
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />
      <Component {...pageProps} />
    </>
  );
}

export default MyApp;
