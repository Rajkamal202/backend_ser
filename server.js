const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config();

app.use(express.json()); 

// Zoho Billing API Configuration
const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; 

// Webhook Endpoint
app.post("/paddle-webhook", async (req, res) => {
  try {
    // Parse the event data
    const eventData = req.body;
    const eventType = eventData.event_type;  // Use event_type here

    console.log(`Received Paddle event: ${eventType}`, eventData);

    // Handle specific events based on event_type
    if (eventType === "subscription.created") {
      await handleSubscriptionCreated(eventData);
    } else if (eventType === "transaction.completed") {
      await handleTransactionCompleted(eventData);
    } else {
      console.log(`Unhandled event: ${eventType}`);
    }

    // Respond to Paddle
    res.status(200).send("Webhook received successfully");
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Handle subscription created event
async function handleSubscriptionCreated(eventData) {
  try {
    // Logic to handle subscription creation
    const customerId = eventData.data.customer_id;
    const subscriptionId = eventData.data.id;

    console.log(`Handling subscription created for customer: ${customerId}, subscription ID: ${subscriptionId}`);

    // You can now use customerId and subscriptionId to interact with your database or Zoho API
    // Add any additional processing or saving logic here if necessary

  } catch (error) {
    console.error("Error handling subscription created event:", error);
  }
}

// Handle transaction completed event
async function handleTransactionCompleted(eventData) {
  try {
    // Extract relevant details from the transaction
    const transactionId = eventData.data.id;
    const amount = eventData.data.items[0].amount;
    const currency = eventData.data.currency_code;
    const customerId = eventData.data.customer_id;

    console.log(`Handling transaction completed for customer: ${customerId}, transaction ID: ${transactionId}`);

    // Process the payment and create an invoice in Zoho Billing or any other related logic
    await handlePaymentSucceeded(eventData); // Reuse your payment handler logic

  } catch (error) {
    console.error("Error handling transaction completed event:", error);
  }
}

// Handle payment succeeded event (reused from your original code
async function handlePaymentSucceeded(eventData) {
  try {
    const data = eventData.data;

    const customerEmail = data.payments?.[0]?.billing_details?.email || "testuser@fallback.com";
    const amount = data.items?.[0]?.price?.unit_price?.amount || data.items?.[0]?.amount;
    const currency = data.currency_code;

    if (!customerEmail || !amount || !currency) {
      console.error("❌ Missing customerEmail / amount / currency");
      console.error({ customerEmail, amount, currency });
      return;
    }

    console.log(`✅ Processing payment for ${customerEmail}: ${amount} ${currency}`);

    const customerId = await getOrCreateCustomerInZoho(customerEmail);
    await createInvoiceInZoho(customerId, amount, currency);

    console.log("✅ Invoice created in Zoho Billing successfully");
  } catch (error) {
    console.error("❌ Error handling payment succeeded:", error);
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

