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
    // Add this log to see the exact data being sent
    const invoiceData = {
      // customer_id: "0", // Using customer_id: 0 might cause issues later, ideally find/create a real customer
      // Instead of customer_id: 0, let's try associating by email if the API supports it, or create the customer first.
      // For now, let's just send customer_name as you did.
      customer_name: customerEmail,
      line_items: [
        {
          name: "Subscription Payment",
          rate: amount, // Make sure 'amount' is defined and has the correct value
          quantity: 1 // Quantity is often required
        },
      ],
      currency_code: currency,
    };
    console.log("Sending data to Zoho Invoice:", JSON.stringify(invoiceData)); // Log the data
    console.log("Using Access Token:", ZOHO_OAUTH_TOKEN); // Log the token being used
    console.log("Using Org ID:", ZOHO_ORGANIZATION_ID); // Log the Org ID

    const response = await axios.post(
      ZOHO_BILLING_API_URL, // Should be https://invoice.zoho.in/api/v3/invoices
      invoiceData,          // Use the prepared data object
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
          // *** CHANGE THIS LINE: ***
          "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
        },
      }
    );

    console.log("Invoice created:", response.data.invoice.invoice_number);
  } catch (error) {
    // Log the detailed error response from Zoho if available
    if (error.response) {
        console.error("Error creating invoice in Zoho:", error.response.status, error.response.data);
    } else {
        console.error("Error creating invoice in Zoho:", error.message);
    }
    // It's better to let the caller handle the re-throw if needed
    // throw error; // Removed throw to prevent crashing the webhook handler completely on error
  }
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
