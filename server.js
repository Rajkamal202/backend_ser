const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();

// Environment Variables (with checks)
const PADDLE_PUBLIC_KEY = process.env.PADDLE_PUBLIC_KEY;
const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;

if (!PADDLE_PUBLIC_KEY || !ZOHO_BILLING_API_URL || !ZOHO_OAUTH_TOKEN) {
  throw new Error("Missing required environment variables");
}

// Capture raw body for signature verification
const rawBodySaver = (req, res, buf) => {
  if (buf && buf.length) {
    req.rawBody = buf.toString("utf8");
  }
};

app.use(
  "/paddle-webhook",
  express.raw({ type: "*/*", verify: rawBodySaver })
);

// Paddle Signature Verification
function verifyPaddleSignature(rawPayload, signature) {
  try {
    const verifier = crypto.createVerify("sha1");
    verifier.update(rawPayload, "utf8");
    return verifier.verify(PADDLE_PUBLIC_KEY, signature, "base64");
  } catch (error) {
    console.error("Error verifying Paddle signature:", error);
    return false;
  }
}

// Webhook Endpoint
app.post("/paddle-webhook", async (req, res) => {
  try {
    const signature = req.body.p_signature;

    const rawBody = req.rawBody;
    const parsedBody = Object.fromEntries(new URLSearchParams(rawBody));

    console.log("🔐 Received signature:", signature);
    console.log("📦 Parsed Body:", parsedBody);

    // Verify signature
    const isValid = verifyPaddleSignature(rawBody, signature);
    if (!isValid) {
      console.warn("🚫 Invalid Paddle webhook signature");
      return res.status(403).send("Invalid signature");
    }

    const alertName = parsedBody.alert_name;
    console.log(`📢 Event received: ${alertName}`);

    // Process supported event
    if (alertName === "payment_succeeded") {
      await handlePaymentSucceeded(parsedBody);
    } else {
      console.log(`❓ Unhandled event type: ${alertName}`);
    }

    res.status(200).send("Webhook received");
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.status(500).send("Internal server error");
  }
});

// Handle payment succeeded
async function handlePaymentSucceeded(data) {
  const email = data.email;
  const amount = parseFloat(data.amount);
  const currency = data.currency;
  const plan = data.subscription_plan_name || "Subscription";

  console.log(`💳 Payment succeeded: ${email}, ${amount} ${currency}`);

  const customerId = await getOrCreateCustomerInZoho(email);
  await createInvoiceInZoho(customerId, amount, currency, plan);

  console.log("🧾 Invoice created successfully");
}

// Get or create customer in Zoho
async function getOrCreateCustomerInZoho(email) {
  try {
    const res = await axios.get("https://invoice.zoho.in/api/v3/customers", {
      headers: {
        Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
      },
      params: { email },
    });

    if (res.data.customers?.length > 0) {
      return res.data.customers[0].customer_id;
    }

    const createRes = await axios.post(
      "https://invoice.zoho.in/api/v3/customers",
      {
        customer_name: email.split("@")[0],
        email,
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    return createRes.data.customer.customer_id;
  } catch (error) {
    console.error("⚠️ Customer fetch/create error:", error);
    throw error;
  }
}

// Create invoice in Zoho
async function createInvoiceInZoho(customerId, amount, currency, plan) {
  try {
    const res = await axios.post(
      ZOHO_BILLING_API_URL,
      {
        customer_id: customerId,
        line_items: [
          {
            name: `Paddle Payment - ${plan}`,
            rate: amount,
          },
        ],
        currency_code: currency,
      },
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("🧾 Zoho Invoice:", res.data.invoice.invoice_number);
  } catch (error) {
    console.error("⚠️ Invoice creation error:", error.response?.data || error);
    throw error;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
