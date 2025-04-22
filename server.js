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

    // --- NEW: Get Zoho Customer ID ---
    const customerId = await getZohoCustomerId(customerEmail);
    // --- END NEW ---

    if (customerId) {
      // Pass customerId INSTEAD of customerEmail to createInvoiceInZoho
      await createInvoiceInZoho(customerId, amount, currency);
    } else {
      console.error(`Could not find or create Zoho customer for email: ${customerEmail}. Invoice not created.`);
    }

  } catch (error) {
    console.error("Error handling transaction completed event:", error);
  }
}

// --- NEW FUNCTION ---
// Function to find an existing Zoho Contact by email or create a new one
async function getZohoCustomerId(email) {
  const ZOHO_CONTACTS_API_URL = "https://www.zohoapis.in/invoice/v3/contacts"; // Base URL for contacts

  try {
    // --- STEP 1: Search for the contact by email ---
    console.log(`Searching for Zoho contact with email: ${email}`);
    const searchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
      headers: {
        Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
        "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
      },
      params: {
        email: email // Parameter to search by email
      }
    });

    // Check the response structure based on Zoho docs
    
    // Assuming response.data.contacts is an array
    if (searchResponse.data && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
      const customerId = searchResponse.data.contacts[0].contact_id; // Or customer_id, check Zoho docs!
      console.log(`Found existing Zoho contact. ID: ${customerId}`);
      return customerId;
    } else {
      // --- STEP 2: Contact not found, create a new one ---
      console.log(`Contact not found for ${email}, creating new one...`);
      // Consult Zoho docs for required fields. Minimally, name and email.
      // Using email as name if no other name is available from Paddle.
      const createPayload = {
        contact_name: email, // Or use a name from Paddle if available
        email: email,
        // Add other fields as needed/required by Zoho
      };

      const createResponse = await axios.post(ZOHO_CONTACTS_API_URL, createPayload, {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
          "Content-Type": "application/json",
        }
      });

      // Check response structure based on Zoho docs
      // Assuming response.data.contact contains the new contact info
      if (createResponse.data && createResponse.data.contact) {
        const newCustomerId = createResponse.data.contact.contact_id; // Or customer_id, check Zoho docs!
        console.log(`Created new Zoho contact. ID: ${newCustomerId}`);
        return newCustomerId;
      } else {
        console.error("Failed to create Zoho contact, unexpected response:", createResponse.data);
        return null;
      }
    }
  } catch (error) {
    if (error.response) {
        console.error("Error searching/creating Zoho contact:", error.response.status, error.response.data);
    } else {
        console.error("Error searching/creating Zoho contact:", error.message);
    }
    return null; // Return null on error
  }
}

// Create Invoice in Zoho Billing (Modified)
// Accepts customerId instead of customerEmail now
async function createInvoiceInZoho(customerId, amount, currency) { // <-- Changed parameters
  try {
    const invoiceData = {
      customer_id: customerId, // <-- Use the customerId passed in
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
      ZOHO_BILLING_API_URL, // Make sure this is https://www.zohoapis.in/invoice/v3/invoices
      invoiceData,          // Use the prepared data object
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
          "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
        },
      }
    );

    console.log("Invoice created:", response.data.invoice.invoice_number);
  } catch (error) {
    if (error.response) {
        console.error("Error creating invoice in Zoho:", error.response.status, error.response.data);
    } else {
        console.error("Error creating invoice in Zoho:", error.message);
    }
  }
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
