const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config(); 

app.use(express.json());

const ZOHO_API_BASE_URL = "https://sandbox.zohoapis.com";
const ZOHO_BILLING_API_VERSION_PATH = "/billing/v1";
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;


async function getPaddleCustomerDetails(paddleCustomerId) {
    const PADDLE_API_BASE_URL = "https://sandbox-api.paddle.com";
    if (!paddleCustomerId) {
        console.error("getPaddleCustomerDetails: Need Paddle Customer ID.");
        return null;
    }
    if (!PADDLE_API_KEY) {
        console.error("getPaddleCustomerDetails: PADDLE_API_KEY missing.");
        return null;
    }

    const PADDLE_CUSTOMER_URL = `${PADDLE_API_BASE_URL}/customers/${paddleCustomerId}`;
    console.log(`Calling Paddle API: ${PADDLE_CUSTOMER_URL}`);

    try {
        const response = await axios.get(PADDLE_CUSTOMER_URL, {
            headers: {
                'Authorization': `Bearer ${PADDLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Get email and name from Paddle response
        const email = response.data?.data?.email;
        const name = response.data?.data?.name; 

        if (!email) {
             console.warn(`getPaddleCustomerDetails: Email missing in Paddle response for ${paddleCustomerId}.`);
        }

        console.log(`Got Paddle details: Email: ${email}, Name: ${name}`);
        // Send back email and name
        return { email, name };
    } catch (error) {
        console.error(`Error getting Paddle customer ${paddleCustomerId}`);
        if (error.response) {
           console.error("Paddle API Error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
        } else {
           console.error("Paddle API Error:", error.message);
        }
        return null; // Failed
    }
}


/**
 * Find Zoho customer using email. If not found, create new one.
 * Uses Zoho Billing API. Returns Zoho customer ID.
 */
async function getZohoCustomerId(email, name) {
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/customers`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    // Check email exists
    if (!email) {
        console.error("getZohoCustomerId: Email needed.");
        return null;
    }
    // Use email for name if name is missing
    const customerDisplayName = name || email;

    // Try searching Zoho customer
    try {
        console.log(`Searching Zoho Billing customer: ${email}`);
        // Call Zoho API to find customer by email
        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: {
                Authorization: AUTH_HEADER,
                ...ORG_HEADER
            },
            params: { email: email } // Filter by email
        });

        // Check if customer found in response
        if (searchResponse.data?.customers?.length > 0) {
            // Found customer! Get ID.
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
            // Customer not found, so create new one
            console.log(`Customer not found, creating: ${customerDisplayName}...`);
            // Prepare data for new customer
            const createPayload = {
                display_name: customerDisplayName,
                email: email,
            };
            console.log("Creating Zoho customer payload:", JSON.stringify(createPayload));

            // Try creating the customer
            try {
                // Call Zoho API to create customer
                const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, {
                    headers: {
                        Authorization: AUTH_HEADER,
                        ...ORG_HEADER,
                        "Content-Type": "application/json",
                    }
                });

                // Check if create worked and gave ID
                if (createResponse.data?.customer?.customer_id) {
                    const newCustomerId = createResponse.data.customer.customer_id;
                    console.log(`Created Zoho customer. ID: ${newCustomerId}`);
                    return newCustomerId; // Return the new ID
                } else {
                    // Something wrong with response after create
                    console.error("Failed create Zoho customer, bad response:", JSON.stringify(createResponse.data));
                    return null;
                }
            // If error during create...
            } catch (createError) {
                console.error("Error creating Zoho customer - Status:", createError.response?.status, "Data:", JSON.stringify(createError.response?.data || createError.message));
                return null;
            }
        }
    // If error during search...
    } catch (searchError) {
        // If 404 error, maybe customer just doesn't exist, so try creating
        if (searchError.response && searchError.response.status === 404) {
             console.log(`Zoho customer search 404 for ${email}, try create.`);
             // Try creating (same logic as above 'else' block)
             const customerDisplayName = name || email;
             const createPayload = { display_name: customerDisplayName, email: email };
             console.log("Creating Zoho customer payload (after 404):", JSON.stringify(createPayload));
             try {
                 const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, { headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" } });
                 if (createResponse.data?.customer?.customer_id) {
                     const newCustomerId = createResponse.data.customer.customer_id;
                     console.log(`Created Zoho customer after 404. ID: ${newCustomerId}`);
                     return newCustomerId;
                 } else {
                     console.error("Failed create after 404, bad response:", JSON.stringify(createResponse.data)); return null;
                 }
             } catch (createError) {
                 console.error("Error creating Zoho customer after 404 - Status:", createError.response?.status, "Data:", JSON.stringify(createError.response?.data || createError.message)); return null;
             }
        } else {
            // Other search error
             console.error("Error searching Zoho customer - Status:", searchError.response?.status, "Data:", JSON.stringify(searchError.response?.data || searchError.message));
             return null;
        }
    }
}

/**
 * Create invoice in Zoho Billing.
 * Need Zoho customer ID, amount, currency.
 * Return invoice ID or null.
 */
async function createInvoiceInZoho(customerId, amount, currency) {
    let createdInvoiceId = null; // To store result
    // Zoho Billing API URL for invoices
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices`;
    // Auth and Org headers
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    // Try creating invoice
    try {
        // --- Data to send to Zoho ---
        // ** WARNING: Check Zoho Billing v1 docs for POST /invoices! This is GUESS! **
        // ** Need correct structure, maybe item_id or plan_code needed? **
        // ** Create Item/Plan in Zoho Billing Sandbox first! **
        const invoiceData = {
            customer_id: customerId, // Link to customer
            // --- Example using Item ID (Likely needed) ---
             line_items: [
                 {
                     item_id: "YOUR_ZOHO_BILLING_ITEM_ID", // !! REPLACE THIS with actual Item ID from Zoho Billing Sandbox !!
                     quantity: 1,
                     price: amount // Check if price override works
                 }
             ],
            currency_code: currency, // Currency like "INR"
        };
        // Log data and URL
        console.log("Sending data to Zoho Billing Invoice:", JSON.stringify(invoiceData));
        console.log("Calling URL:", ZOHO_INVOICES_API_URL);
        console.log("Using Org ID:", ZOHO_ORGANIZATION_ID);

        // Call Zoho POST /invoices API
        const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, {
            headers: {
                Authorization: AUTH_HEADER,
                "Content-Type": "application/json",
                ...ORG_HEADER,
            },
        });

        // Check response for invoice ID
        // ** WARNING: Check Billing docs for correct response structure! **
        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message); // Log Zoho message
            console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
        } else {
            // Response OK, but no ID?
            console.error("Invoice created but ID missing in response", JSON.stringify(response.data));
        }

    // If error during invoice creation...
    } catch (error) {
        console.error("Error creating Zoho Billing invoice - Status:", error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
    // Return the ID (or null if failed)
    return createdInvoiceId;
}

/**
 * Email invoice from Zoho Billing.
 * Need invoice ID and recipient email.
 */
async function emailZohoInvoice(invoiceId, recipientEmail) {
    // Check inputs
    if (!invoiceId || !recipientEmail) {
        console.error("Cannot email invoice: Missing ID or Email.");
        return;
    }
    // Zoho Billing API URL for emailing invoice
    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices/${invoiceId}/email`;
    // Auth and Org headers
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    // Try sending email
    try {
        console.log(`Trying email invoice ${invoiceId} to ${recipientEmail}`);
        // Data for email API
        // ** WARNING: Check Billing docs for correct payload! Maybe just email needed? **
        const emailPayload = {
            to_mail_ids: [recipientEmail], // Send to this email
            // subject: "Your Invoice from Autobot", // Check if allowed
            // body: "Thank you..." // Check if allowed
        };
        console.log("Sending Email Payload:", JSON.stringify(emailPayload));

        // Call Zoho POST /invoices/{id}/email API
        const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
            headers: {
                Authorization: AUTH_HEADER,
                ...ORG_HEADER,
                "Content-Type": "application/json"
            }
        });
        // Log Zoho response message
        console.log(`Email Invoice Response for ${invoiceId}:`, response.data?.message || JSON.stringify(response.data));

    // If error during email sending...
    } catch (error) {
         console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
}


/**
 * Main function to handle Paddle 'transaction.completed' webhook.
 * Gets data, calls Paddle API, calls Zoho API.
 */
async function handleTransactionCompleted(eventData) {
    // Try block for whole process
    try {
        // Get data from webhook
        const transactionId = eventData.data?.id;
        const occurredAt = eventData.data?.occurred_at;
        const paddleCustomerId = eventData.data?.customer_id;

        console.log(`Processing transaction.completed: ${transactionId}`);

        // Check if Paddle customer ID exists
        if (!paddleCustomerId) {
            console.error(`ERROR: No Paddle Customer ID in webhook for TxID ${transactionId}. Cannot continue.`);
            return;
        }

        // --- Step 1: Get customer details from Paddle ---
        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

        // --- Step 2: Check if email received from Paddle ---
        if (!customerDetails || !customerDetails.email) {
            console.error(`ERROR: No email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Stopping.`);
            return; // Stop if no email
        }

        // --- Step 3: Use Paddle details ---
        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail; // Use email if name is null
        console.log(`Got from Paddle API: Email=${customerEmail}, Name=${customerName}`);

        // --- Step 4: Get amount and currency from webhook ---
        let amount = 0;
        const amountFromPaddle = eventData.data?.payments?.[0]?.amount; // Check this path
        if (amountFromPaddle) {
            const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0; // Convert to normal amount (like 599.00)
            } else {
               console.error(`Bad amount format: "${amountFromPaddle}" for TxID ${transactionId}`);
            }
        } else {
          console.warn(`Amount missing in webhook for TxID ${transactionId}.`);
        }
        const currency = eventData.data?.currency_code; // Get currency (like "INR")
        if (!currency) {
            console.error(`Currency missing for TxID ${transactionId}.`);
        }

        // --- Step 5: Call Zoho functions ---
        console.log(`Handling transaction: Customer=${customerEmail}, Name=${customerName}, TxID=${transactionId}, Amount=${amount} ${currency}`);

        // Check we have needed data before calling Zoho
        if (!customerEmail || amount <= 0 || !currency) {
            console.error(`Missing data before Zoho calls for TxID ${transactionId}. Stopping.`);
            return;
        }

        // Get or create Zoho customer ID using Billing API
        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        // If we got Zoho customer ID...
        if (zohoCustomerId) {
            // Create Zoho invoice using Billing API
            // ** WARNING: Make sure createInvoiceInZoho uses correct payload (item_id?) **
            const invoiceId = await createInvoiceInZoho(zohoCustomerId, amount, currency);

            // If invoice created...
            if (invoiceId) {
                console.log(`Invoice ${invoiceId} created in Zoho Billing for TxID ${transactionId}.`);
                // Email the invoice using Billing API
                console.log(`Trying email invoice ${invoiceId} to ${customerEmail} for TxID ${transactionId}.`);
                await emailZohoInvoice(invoiceId, customerEmail);
            } else {
                // Invoice creation failed
                console.error(`Zoho invoice creation failed for TxID ${transactionId}. Email not sent.`);
            }
        } else {
            // Failed to get/create Zoho customer
            console.error(`Zoho customer step failed for ${customerEmail}. Invoice not created for TxID ${transactionId}.`);
        }

    // If any big error happens...
    } catch (error) {
        console.error("Error in handleTransactionCompleted:", error);
    }
}

// --- Webhook Endpoint ---
// This part listens for messages from Paddle at /paddle-webhook
app.post("/paddle-webhook", async (req, res) => {
    console.log(`--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`);
    try {
        // Get data from Paddle request
        const eventData = req.body;

        // Log all data received (good for debug)
        console.log(">>> Paddle Webhook Received Data:", JSON.stringify(eventData, null, 2));

        // Get event type (like 'transaction.completed')
        const eventType = eventData?.event_type;
        console.log(`Received Paddle event type: ${eventType}`);

        // Check if it's the event we want
        if (eventType === "transaction.completed") {
            // Call our main function to handle it
            // .catch stops server crash if error inside
            handleTransactionCompleted(eventData).catch(err => {
                console.error("Error processing transaction completed handler:", err);
            });
            // Send 'OK' back to Paddle right away
            res.status(200).send("Webhook received successfully, processing initiated.");

        } else {
            // If it's some other event
            console.log(`Unhandled event type: ${eventType}`);
            // Still send 'OK' back to Paddle
            res.status(200).send(`Webhook received, unhandled event type: ${eventType}`);
        }
    // If error handling request itself...
    } catch (error) {
        console.error("Error processing webhook:", error);
        // Send server error back to Paddle
        res.status(500).send("Internal Server Error during webhook processing");
    }
});

// --- Server Start ---
// Get port from environment or use 3000
const PORT = process.env.PORT || 3000;
// Start server listening
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Check if important .env variables are set (optional warning)
    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
});

