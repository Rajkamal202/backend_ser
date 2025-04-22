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
  // Use the correct base URL for the India data center
  const ZOHO_CONTACTS_API_URL = "https://www.zohoapis.in/invoice/v3/contacts";
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    // --- STEP 1: Search for the contact by email ---
    console.log(`Searching for Zoho contact with email: ${email}`);
    // Documentation suggests using 'email_contains' or 'email' as query param
    // Let's try 'email' first as it's simpler for exact match.
    const searchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
      headers: {
        Authorization: AUTH_HEADER,
        ...ORG_HEADER // Spread operator to include organization header
      },
      params: {
        email: email // Search parameter based on documentation examples
      }
    });

    // --- Check Search Response ---
    // IMPORTANT: Verify the actual response structure from Zoho.
    // Assuming the response has a 'contacts' array based on typical API patterns.
    if (searchResponse.data && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
      // Assuming the ID field is 'contact_id'
      const customerId = searchResponse.data.contacts[0].contact_id;
      console.log(`Found existing Zoho contact. ID: ${customerId}`);
      return customerId;
    } else {
      // --- STEP 2: Contact not found, create a new one ---
      console.log(`Contact not found for ${email}, creating new one...`);

      // Construct the payload for creating a contact.
      // 'contact_name' is typically required. Using email as name if no other name is available.
      const createPayload = {
        contact_name: email, // You might want to get a real name from Paddle if possible
        email: email,
        // Add any other relevant fields here if needed, e.g., company_name
        // payment_terms: 0, // Example: 'Due on Receipt'
        // currency_id: 'ID_FOR_INR', // Might be needed if default isn't INR
      };
      console.log("Creating Zoho contact with payload:", JSON.stringify(createPayload));

      // Use POST request with JSON body
      const createResponse = await axios.post(ZOHO_CONTACTS_API_URL, createPayload, {
        headers: {
          Authorization: AUTH_HEADER,
          ...ORG_HEADER,
          "Content-Type": "application/json",
        }
      });

      // --- Check Create Response ---
      // IMPORTANT: Verify the actual response structure from Zoho.
      // Assuming the response has a 'contact' object with the ID.
      if (createResponse.data && createResponse.data.contact && createResponse.data.contact.contact_id) {
        const newCustomerId = createResponse.data.contact.contact_id;
        console.log(`Created new Zoho contact. ID: ${newCustomerId}`);
        return newCustomerId;
      } else {
        // Log the actual response if creation didn't return expected structure
        console.error("Failed to create Zoho contact or parse response:", createResponse.data);
        return null;
      }
    }
  } catch (error) {
    // Log detailed error information
    if (error.response) {
      // Error from Zoho API (e.g., 4xx, 5xx)
      console.error("Error searching/creating Zoho contact - Status:", error.response.status);
      console.error("Error searching/creating Zoho contact - Data:", JSON.stringify(error.response.data));
    } else if (error.request) {
      // Request was made but no response received
      console.error("Error searching/creating Zoho contact - No response received:", error.request);
    } else {
      // Error setting up the request
      console.error("Error searching/creating Zoho contact - Request setup error:", error.message);
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
