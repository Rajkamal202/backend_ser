const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config();

app.use(express.json());

// Zoho Billing API Configuration
const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID; // Ensure this is set

// Webhook Endpoint
app.post("/paddle-webhook", async (req, res) => {
  try {
    const eventData = req.body;
    const eventType = eventData.event_type;

    console.log(`Received Paddle event: ${eventType}`, eventData);

    if (eventType === "transaction.completed") {
      await handleTransactionCompleted(eventData);
    } else {
      console.log(`Unhandled event: ${eventType}`);
    }

    res.status(200).send("Webhook received successfully");
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Handle transaction completed event
async function handleTransactionCompleted(eventData) {
  try {
    const transactionId = eventData.data.id;
    const amount = eventData.data.items[0].amount;
    const currency = eventData.data.currency_code;
    const customerEmail = eventData.data.payments?.[0]?.billing_details?.email || "testuser@fallback.com";

    console.log(`Handling transaction completed for customer: ${customerEmail}, transaction ID: ${transactionId}`);

    // Directly create the invoice (simplified)
    await createInvoiceInZoho(amount, currency, customerEmail);

  } catch (error) {
    console.error("Error handling transaction completed event:", error);
  }
}

// Create Invoice in Zoho Billing (Modified)
async function createInvoiceInZoho(amount, currency, customerEmail) {
  try {
    const response = await axios.post(
      ZOHO_BILLING_API_URL,
      {
        customer_id: "0", // Or a suitable placeholder for testing
        customer_name: customerEmail, // Or however you want to identify the customer for testing
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
          "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID, //Still Crucial!
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
