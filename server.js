// Main application code (e.g., server.js)
const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config();

app.use(express.json());

// --- Configuration - Ensure these are set for your SANDBOX environment ---
// Base URL for Zoho Invoice/Books API calls (Sandbox, US Datacenter assumed)
const ZOHO_API_BASE_URL = "https://sandbox.zohoapis.com"; // Use .com for US, .in for India etc.
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; // Use a valid SANDBOX Access Token (consider refresh logic for real use)
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID; // Use your SANDBOX Org ID

// --- Helper Functions ---

/**
 * Gets Zoho Customer ID by email. Creates contact if not found.
 * @param {string} email - Customer's email.
 * @param {string} name - Customer's name (used if creating contact).
 * @returns {Promise<string|null>} Customer ID or null if error.
 */
async function getZohoCustomerId(email, name) {
  // Use correct API endpoint for your region/product (assuming US sandbox Invoice)
  const ZOHO_CONTACTS_API_URL = `${ZOHO_API_BASE_URL}/invoice/v3/contacts`;
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  if (!email) {
      console.error("getZohoCustomerId: Email is required.");
      return null;
  }
  // Use email as name if name is not provided
  const contactName = name || email;

  try {
    console.log(`Searching for Zoho contact with email: ${email}`);
    const searchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
      headers: {
        Authorization: AUTH_HEADER,
        ...ORG_HEADER
      },
      params: { email: email }
    });

    if (searchResponse.data?.contacts?.length > 0) {
      const customerId = searchResponse.data.contacts[0].contact_id;
      console.log(`Found existing Zoho contact. ID: ${customerId}`);
      return customerId;
    } else {
      console.log(`Contact not found for ${email}, attempting to create with name: ${contactName}...`);
      const createPayload = {
        contact_name: contactName, // Use the provided name
        email: email,
      };
      console.log("Creating Zoho contact payload:", JSON.stringify(createPayload));

      try {
        const createResponse = await axios.post(ZOHO_CONTACTS_API_URL, createPayload, {
          headers: {
            Authorization: AUTH_HEADER,
            ...ORG_HEADER,
            "Content-Type": "application/json",
          }
        });

        if (createResponse.data?.contact?.contact_id) {
          const newCustomerId = createResponse.data.contact.contact_id;
          console.log(`Created new Zoho contact. ID: ${newCustomerId}`);
          return newCustomerId;
        } else {
          console.error("Failed to create Zoho contact, unexpected response:", JSON.stringify(createResponse.data));
          return null;
        }
      } catch (createError) {
        // Simplified error handling for creation
        if (createError.response) {
           console.error("Error creating Zoho contact - Status:", createError.response.status, "Data:", JSON.stringify(createError.response.data));
        } else {
           console.error("Error creating Zoho contact:", createError.message);
        }
        // Note: Removed the complex re-search logic for simplicity, might need it back later
        return null;
      }
    }
  } catch (searchError) {
    if (searchError.response) {
       console.error("Error during contact search - Status:", searchError.response.status, "Data:", JSON.stringify(searchError.response.data));
    } else {
       console.error("Error during contact search:", searchError.message);
    }
    return null;
  }
}

/**
 * Creates an invoice (as Draft) in Zoho.
 * @param {string} customerId - Zoho Customer ID.
 * @param {number} amount - Invoice amount.
 * @param {string} currency - Currency code (e.g., "USD", "INR").
 * @returns {Promise<string|null>} Invoice ID or null if error.
 */
async function createInvoiceInZoho(customerId, amount, currency) {
  let createdInvoiceId = null;
  // Use correct API endpoint for your region/product (assuming US sandbox Invoice)
  const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}/invoice/v3/invoices`;
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    const invoiceData = {
      customer_id: customerId,
      line_items: [
        {
          // Consider making this more dynamic if Paddle provides product info
          name: "Subscription Payment",
          description: "Payment processed via Paddle.", // Optional description
          rate: amount,
          quantity: 1
        },
      ],
      currency_code: currency,
      // Optionally set due date, terms etc.
      // due_date: new Date().toISOString().split('T')[0] // Example: Due today
    };
    console.log("Sending data to Zoho Invoice:", JSON.stringify(invoiceData));
    console.log("Calling URL:", ZOHO_INVOICES_API_URL);
    // console.log("Using Access Token:", ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'undefined'); // Log part of token if debugging
    console.log("Using Org ID:", ZOHO_ORGANIZATION_ID);

    const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, {
      headers: {
        Authorization: AUTH_HEADER,
        "Content-Type": "application/json",
        ...ORG_HEADER,
      },
    });

    if (response.data?.invoice?.invoice_id) {
        createdInvoiceId = response.data.invoice.invoice_id;
        console.log("Invoice Creation Response:", response.data.message);
        console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
    } else {
        console.error("Invoice created but ID not found in response", JSON.stringify(response.data));
    }

  } catch (error) {
    if (error.response) {
        console.error("Error creating invoice in Zoho - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
    } else {
        console.error("Error creating invoice in Zoho:", error.message);
    }
  }
  return createdInvoiceId;
}

/**
 * Emails an existing Zoho Invoice.
 * @param {string} invoiceId - Zoho Invoice ID.
 * @param {string} recipientEmail - Email address to send to.
 */
async function emailZohoInvoice(invoiceId, recipientEmail) {
  if (!invoiceId || !recipientEmail) {
    console.error("Cannot email invoice: Missing invoiceId or recipientEmail.");
    return;
  }
  // Use correct API endpoint for your region/product (assuming US sandbox Invoice)
  const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}/invoice/v3/invoices/${invoiceId}/email`;
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    console.log(`Attempting to email invoice ${invoiceId} to ${recipientEmail}`);
    const emailPayload = {
        to_mail_ids: [recipientEmail],
        subject: "Your Invoice from Autobot", // Customize subject
        body: "Thank you for your business! <br><br>Please find your invoice attached.<br><br>Regards,<br>Autobot Team" // Customize body
    };
    console.log("Sending Email Payload:", JSON.stringify(emailPayload));

    const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
        headers: {
            Authorization: AUTH_HEADER,
            ...ORG_HEADER,
            "Content-Type": "application/json"
        }
    });
    console.log(`Email Invoice Response for ${invoiceId}:`, response.data?.message || JSON.stringify(response.data));

  } catch (error) {
     if (error.response) {
        console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response.status, "Data:", JSON.stringify(error.response.data));
     } else {
        console.error(`Error emailing invoice ${invoiceId}:`, error.message);
     }
  }
}

/**
 * Fetches customer details from Paddle API using customer ID.
 * @param {string} paddleCustomerId - The Paddle Customer ID (e.g., ctm_...).
 * @returns {Promise<{email: string, name: string}|null>} Object with email/name or null.
 */
async function getPaddleCustomerDetails(paddleCustomerId) {
    // --- Get Paddle API Key from environment variables ---
    const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
    const PADDLE_API_BASE_URL = "https://sandbox-api.paddle.com";

    if (!paddleCustomerId) {
        console.error("getPaddleCustomerDetails: Paddle Customer ID is required.");
        return null;
    }
    if (!PADDLE_API_KEY) {
        console.error("getPaddleCustomerDetails: PADDLE_API_KEY environment variable not set.");
        return null;
    }

   const PADDLE_CUSTOMER_URL = `${PADDLE_API_BASE_URL}/customers/${paddleCustomerId}`; // CORRECTED URL construction
   console.log(`Workspaceing Paddle customer details from: ${PADDLE_CUSTOMER_URL}`); // CORRECTED log message

    try {
        const response = await axios.get(PADDLE_CUSTOMER_URL, {
            headers: {
                // Ensure correct Authentication header format for Paddle API
                'Authorization': `Bearer ${PADDLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // ** VERIFY these paths in Paddle API documentation for customer object **
        // Adjust '.data.email' and '.data.name' if Paddle's response structure is different
        const email = response.data?.data?.email;
        const name = response.data?.data?.name;

        if (!email) {
             console.warn(`getPaddleCustomerDetails: Email not found in Paddle response for customer ${paddleCustomerId}. Response Data:`, JSON.stringify(response.data));
             // Decide if you want to return null or an object without email
        }

        console.log(`Successfully fetched Paddle details for ${paddleCustomerId}. Email: ${email}, Name: ${name}`);
        // Return extracted details (name might be null)
        return { email, name };

    } catch (error) {
        console.error(`Error fetching Paddle customer details for ${paddleCustomerId}`);
        if (error.response) {
           console.error("Paddle API Error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
        } else {
           console.error("Paddle API Error:", error.message);
        }
        return null; // Return null on error
    }
}
/**
 * Handles the 'transaction.completed' event from Paddle.
 * @param {object} eventData - The full event data from Paddle webhook.
 */
async function handleTransactionCompleted(eventData) {
  try {
    const transactionId = eventData.data?.id;
    const occurredAt = eventData.data?.occurred_at;
    const paddleCustomerId = eventData.data?.customer_id; // Extract Paddle Customer ID

    console.log(`Processing transaction.completed: ${transactionId}`);

    if (!paddleCustomerId) {
        console.error(`ERROR: Paddle Customer ID missing in webhook data for TxID ${transactionId}. Cannot fetch details.`);
        return; // Stop if no customer ID
    }

    // --- Step 1: Fetch Customer Details from Paddle API ---
    const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

    // --- Step 2: Validate Fetched Details (Especially Email) ---
    // **** THIS IS THE CORRECTED CHECK ****
    if (!customerDetails || !customerDetails.email) {
        console.error(`ERROR: Could not retrieve valid customer email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Aborting.`);
        // Check logs from getPaddleCustomerDetails above this for Paddle API errors
        return; // Stop processing if email is missing from Paddle API response
    }

    // --- Step 3: Use Fetched Details ---
    const customerEmail = customerDetails.email;
    // Use fetched name from Paddle API, fallback to the email if name wasn't returned/available
    const customerName = customerDetails.name || customerEmail;

    console.log(`Successfully retrieved from Paddle API: Email=${customerEmail}, Name=${customerName}`);

    // --- Step 4: Extract Amount & Currency from Webhook ---
    let amount = 0;
    const amountFromPaddle = eventData.data?.payments?.[0]?.amount;
    if (amountFromPaddle) {
        const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
        if (!isNaN(amountInSmallestUnit)) {
            amount = amountInSmallestUnit / 100.0; // Assumes currency uses 100 subunits
        } else {
           console.error(`Could not parse amount string: "${amountFromPaddle}" for transaction ${transactionId}`);
        }
    } else {
      console.warn(`Amount not found in payments array for transaction ${transactionId}. Check Paddle payload structure.`);
    }
    const currency = eventData.data?.currency_code;
    if (!currency) {
        console.error(`Currency code missing for transaction ${transactionId}.`);
        // Decide how to handle - maybe default, maybe stop
    }

    // --- Step 5: Main Zoho Logic ---
    console.log(`Handling transaction: Customer=${customerEmail}, Name=${customerName}, TxID=${transactionId}, Amount=${amount} ${currency}`);

    // Add checks here again before calling Zoho functions
    if (!customerEmail || amount <= 0 || !currency) {
        console.error(`Missing required data before calling Zoho functions for TxID ${transactionId}. Aborting.`);
        return;
    }

    const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

    if (zohoCustomerId) {
      const invoiceId = await createInvoiceInZoho(zohoCustomerId, amount, currency);
      if (invoiceId) {
        console.log(`Invoice ${invoiceId} created successfully for TxID ${transactionId}.`);
        console.log(`Attempting to email invoice ${invoiceId} to ${customerEmail} for TxID ${transactionId}.`);
        await emailZohoInvoice(invoiceId, customerEmail);
      } else {
        console.error(`Invoice creation failed for TxID ${transactionId}. Email not sent.`);
      }
    } else {
      console.error(`Could not find or create Zoho customer for ${customerEmail}. Invoice not created for TxID ${transactionId}.`);
    }

  } catch (error) {
    console.error("Error in handleTransactionCompleted:", error);
  }
}

// --- Webhook Endpoint ---
app.post("/paddle-webhook", async (req, res) => {
  // Add a log to confirm the endpoint is hit
  console.log(`--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`);
  try {
    const eventData = req.body;

    // !! IMPORTANT: Log the raw incoming data to verify paths !!
    console.log(">>> Paddle Webhook Received Data:", JSON.stringify(eventData, null, 2));

    const eventType = eventData?.event_type; // Use optional chaining
    console.log(`Received Paddle event type: ${eventType}`);

    if (eventType === "transaction.completed") {
      // Process async but send response quickly
      handleTransactionCompleted(eventData).catch(err => {
          console.error("Error processing transaction completed handler:", err);
          // Optionally add monitoring/alerting here
      });
      // Respond immediately to Paddle
      res.status(200).send("Webhook received successfully, processing initiated.");

    } else {
      console.log(`Unhandled event type: ${eventType}`);
      res.status(200).send(`Webhook received, unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error during webhook processing");
  }
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Verify essential env vars on start
  if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN environment variable not set.");
  if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID environment variable not set.");
});
