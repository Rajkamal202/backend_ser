const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

// 🌍 Load env variables
const PADDLE_PUBLIC_KEY = process.env.PADDLE_PUBLIC_KEY;
const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;

if (!PADDLE_PUBLIC_KEY || !ZOHO_BILLING_API_URL || !ZOHO_OAUTH_TOKEN) {
  throw new Error("Missing required environment variables");
}

// 🧠 Raw body middleware to capture Paddle webhook
const rawBodySaver = (req, res, buf) => {
  if (buf?.length) req.rawBody = buf.toString("utf8");
};

app.use(
  "/paddle-webhook",
  express.raw({ type: "*/*", verify: rawBodySaver })
);

// 🛡️ Signature Verification
function verifyPaddleSignature(payload) {
  const { p_signature, ...data } = payload;

  // Sort the keys alphabetically
  const sorted = Object.keys(data)
    .sort()
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {});

  // Serialize into a buffer (mimic PHP-style serialization)
  const serialized = Object.values(sorted).map(String).join("");

  const verifier = crypto.createVerify("sha1");
  verifier.update(serialized);

  try {
    return verifier.verify(PADDLE_PUBLIC_KEY, p_signature, "base64");
  } catch (error) {
    console.error("🔒 Signature verification failed:", error);
    return false;
  }
}

// 🚪 Paddle Webhook
app.post("/paddle-webhook", async (req, res) => {
  try {
    const parsedBody = Object.fromEntries(new URLSearchParams(req.rawBody));
    const isValid = verifyPaddleSignature(parsedBody);

    if (!isValid) {
      console.warn("🚫 Invalid Paddle webhook signature");
      return res.status(403).send("Invalid signature");
    }

    const alertName = parsedBody.alert_name;
    console.log(`📢 Received event: ${alertName}`);

    if (alertName === "payment_succeeded") {
      await handlePaymentSucceeded(parsedBody);
    } else {
      console.log(`ℹ️ Unhandled event: ${alertName}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Server error");
  }
});

// 💳 Payment Handler
async function handlePaymentSucceeded(data) {
  const email = data.email;
  const amount = parseFloat(data.amount);
  const currency = data.currency;
  const plan = data.subscription_plan_name || "Subscription";

  console.log(`💰 Payment from ${email} for ${amount} ${currency}`);

  const customerId = await getOrCreateCustomerInZoho(email);
  await createInvoiceInZoho(customerId, amount, currency, plan);

  console.log("🧾 Invoice successfully created");
}

// 👤 Get/Create Zoho Customer
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
  } catch (err) {
    console.error("❗ Zoho customer error:", err.response?.data || err);
    throw err;
  }
}

// 🧾 Create Invoice in Zoho
async function createInvoiceInZoho(customerId, amount, currency, plan) {
  try {
    const res = await axios.post(
      ZOHO_BILLING_API_URL,
      {
        customer_id: customerId,
        line_items: [
          {
            name: `Paddle - ${plan}`,
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

    console.log("✅ Invoice Number:", res.data.invoice.invoice_number);
  } catch (err) {
    console.error("❗ Zoho invoice error:", err.response?.data || err);
    throw err;
  }
}

// 🚀 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Server running on port ${PORT}`);
});
