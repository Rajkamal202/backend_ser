const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const app = express();
app.use(express.json()); // Re-enable JSON parsing for easier access to eventData

// Paddle Sandbox Public Key (for verifying webhook signatures)
const PADDLE_PUBLIC_KEY = process.env.PADDLE_PUBLIC_KEY; // Keep this for when you have it

// Zoho Billing API Configuration
const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;

// Helper Function: Verify Paddle Webhook Signature (CURRENTLY NOT USED)
// function verifyPaddleSignature(rawPayload, signature) {
//   if (!PADDLE_PUBLIC_KEY || !signature || !rawPayload) {
//     console.warn("Missing public key, signature, or payload for verification.");
//     return false; // Or handle this case as appropriate for your security needs
//   }
//   try {
//     const verifier = crypto.createVerify("sha1");
//     verifier.update(rawPayload, "utf8");
//     return verifier.verify(PADDLE_PUBLIC_KEY, signature, "base64");
//   } catch (error) {
//     console.error("Error during signature verification:", error);
//     return false;
//   }
// }

// Webhook Endpoint (SIGNATURE VERIFICATION TEMPORARILY REMOVED)
app.post("/paddle-webhook", async (req, res) => {
  try {
    // const rawBody = req.body.toString("utf8");
    const signature = req.headers["paddle-signature"];

    console.log("Signature Header (for info):", signature);
    console.log("Webhook Body:", req.body); // Log the parsed JSON body

    // // TEMPORARILY BYPASSING SIGNATURE VERIFICATION
    console.warn("⚠️⚠️⚠️ Webhook Signature Verification IS CURRENTLY DISABLED! ⚠️⚠️⚠️");

    const eventData = req.body;
    const alertName = eventData.alert_name;

    console.log(`Received Paddle event: ${alertName}`, eventData);

    // Handle specific events
    if (alertName === "payment_succeeded") {
      await handlePaymentSucceeded(eventData);
    } else {
      console.log(`Unhandled event: ${alertName}`);
    }

    // Respond to Paddle
    res.status(200).send("Webhook received successfully");
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error");
  }
});

async function handlePaymentSucceeded(eventData) {
  try {
    // Extract payment details
    const customerEmail = eventData.email;
    const amount = parseFloat(eventData.amount);
    const currency = eventData.currency;

    console.log(`Processing payment for ${customerEmail}: ${amount} ${currency}`);

    // Step 1: Check if the customer exists in Zoho Billing
    const customerId = await getOrCreateCustomerInZoho(customerEmail);

    // Step 2: Create an invoice in Zoho Billing
    await createInvoiceInZoho(customerId, amount, currency);

    console.log("Invoice created in Zoho Billing successfully");
  } catch (error) {
    console.error("Error handling payment succeeded event:", error);
  }
}

// Get or Create Customer in Zoho Billing
async function getOrCreateCustomerInZoho(email) {
  try {
    // Search for the customer by email
    const searchResponse = await axios.get(
      "https://invoice.zoho.in/api/v3/customers",
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
        },
        params: {
          email: email,
        },
      }
    );

    const customers = searchResponse.data.customers || [];

    if (customers.length > 0) {
      // Customer already exists, return their ID
      return customers[0].customer_id;
    } else {
      // Create a new customer
      const createResponse = await axios.post(
        "https://invoice.zoho.in/api/v3/customers",
        {
          customer_name: email.split("@")[0], // Use email prefix as name
          email: email,
        },
        {
          headers: {
            Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      return createResponse.data.customer.customer_id;
    }
  } catch (error) {
    console.error("Error getting/creating customer in Zoho:", error);
    throw error;
  }
}

// Create Invoice in Zoho Billing
async function createInvoiceInZoho(customerId, amount, currency) {
  try {
    const response = await axios.post(
      ZOHO_BILLING_API_URL,
      {
        customer_id: customerId,
        line_items: [
          {
            name: "Subscription Payment",
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

    console.log("Invoice created:", response.data.invoice.invoice_number);
  } catch (error) {
    console.error("Error creating invoice in Zoho:", error);
    throw error;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
