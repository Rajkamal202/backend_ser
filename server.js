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

/**
 * Fetches customer details from Paddle API using customer ID.
 * @param {string} paddleCustomerId - The Paddle Customer ID (e.g., ctm_...).
 * @returns {Promise<{email: string, name: string}|null>} Object with email/name or null.
 */
async function getPaddleCustomerDetails(paddleCustomerId) {
    const PADDLE_API_BASE_URL = "https://sandbox-api.paddle.com";

    if (!paddleCustomerId) {
        console.error("getPaddleCustomerDetails: Paddle Customer ID is required.");
        return null;
    }
    if (!PADDLE_API_KEY) {
        console.error("getPaddleCustomerDetails: PADDLE_API_KEY environment variable not set.");
        return null;
    }

    // Correct Paddle API endpoint for getting a customer
    const PADDLE_CUSTOMER_URL = `${PADDLE_API_BASE_URL}/customers/${paddleCustomerId}`;
    console.log(`Fetching Paddle customer details from: ${PADDLE_CUSTOMER_URL}`);

    try {
        const response = await axios.get(PADDLE_CUSTOMER_URL, {
            headers: {
                'Authorization': `Bearer ${PADDLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // Paths based on successful API call response
        const email = response.data?.data?.email;
        const name = response.data?.data?.name; // Might be null

        if (!email) {
             console.warn(`getPaddleCustomerDetails: Email not found in Paddle response for customer ${paddleCustomerId}. Response Data:`, JSON.stringify(response.data));
        }

        console.log(`Successfully fetched Paddle details for ${paddleCustomerId}. Email: ${email}, Name: ${name}`);
        return { email, name };

    } catch (error) {
        console.error(`Error fetching Paddle customer details for ${paddleCustomerId}`);
        if (error.response) {
           console.error("Paddle API Error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
        } else {
           console.error("Paddle API Error:", error.message);
        }
        return null;
    }
}


/**
 * Gets Zoho Customer ID by email using Zoho Billing API.If customer is not found we will create new customer .
 */
async function getZohoCustomerId(email, name) {
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/customers`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    if (!email) {
        console.error("getZohoCustomerId: Email is required.");
        return null;
    }
    // Use email as display_name if name is not provided (assuming 'display_name' for Billing API)
    const customerDisplayName = name || email;

    try {
        console.log(`Searching for Zoho Billing customer with email: ${email}`);
        // Assuming Billing API uses 'email' parameter for filtering GET /customers
        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: {
                Authorization: AUTH_HEADER,
                ...ORG_HEADER
            },
            params: { email: email }

        // ** ADJUST response parsing based on actual Billing v1 GET /customers response **
        if (searchResponse.data?.customers?.length > 0) {
            // Assuming the ID field is 'customer_id'
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found existing Zoho Billing customer. ID: ${customerId}`);
            return customerId;
        } else {
            console.log(`Customer not found for ${email}, attempting to create with display_name: ${customerDisplayName}...`);
            // ** ADJUST createPayload based on actual Billing v1 POST /customers request body **
            const createPayload = {
                display_name: customerDisplayName, // Assuming field name is 'display_name'
                email: email,
                // Add other necessary fields if required by Billing API
            };
            console.log("Creating Zoho Billing customer payload:", JSON.stringify(createPayload));

            try {
                const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, {
                    headers: {
                        Authorization: AUTH_HEADER,
                        ...ORG_HEADER,
                        "Content-Type": "application/json",
                    }
                });

                // ** ADJUST response parsing based on actual Billing v1 POST /customers response **
                if (createResponse.data?.customer?.customer_id) {
                    const newCustomerId = createResponse.data.customer.customer_id;
                    console.log(`Created new Zoho Billing customer. ID: ${newCustomerId}`);
                    return newCustomerId;
                } else {
                    console.error("Failed to create Zoho Billing customer, unexpected response:", JSON.stringify(createResponse.data));
                    return null;
                }
            } catch (createError) {
                if (createError.response) {
                    console.error("Error creating Zoho Billing customer - Status:", createError.response.status, "Data:", JSON.stringify(createError.response.data));
                } else {
                    console.error("Error creating Zoho Billing customer:", createError.message);
                }
                return null;
            }
        }
    } catch (searchError) {
        // Handle potential 404 if customer not found doesn't return empty list but errors
        if (searchError.response && searchError.response.status === 404) {
             console.log(`Zoho Billing customer search returned 404 for ${email}, proceeding to create.`);
             // Fall through to creation logic (duplicate of above, could be refactored)
             const customerDisplayName = name || email;
             console.log(`Attempting to create with display_name: ${customerDisplayName}...`);
             const createPayload = { display_name: customerDisplayName, email: email };
             console.log("Creating Zoho Billing customer payload:", JSON.stringify(createPayload));
             try {
                 const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, { headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" } });
                 if (createResponse.data?.customer?.customer_id) {
                     const newCustomerId = createResponse.data.customer.customer_id;
                     console.log(`Created new Zoho Billing customer after 404 search. ID: ${newCustomerId}`);
                     return newCustomerId;
                 } else {
                     console.error("Failed to create Zoho Billing customer after 404 search, unexpected response:", JSON.stringify(createResponse.data)); return null;
                 }
             } catch (createError) {
                 if (createError.response) { console.error("Error creating Zoho Billing customer after 404 search - Status:", createError.response.status, "Data:", JSON.stringify(createError.response.data)); } else { console.error("Error creating Zoho Billing customer after 404 search:", createError.message); } return null;
             }
        } else {
            // Handle other search errors
             if (searchError.response) {
                console.error("Error during Billing customer search - Status:", searchError.response.status, "Data:", JSON.stringify(searchError.response.data));
             } else {
                console.error("Error during Billing customer search:", searchError.message);
             }
             return null;
        }
    }
}

/**
 * Creates an invoice using Zoho Billing API.
 * @param {string} customerId - Zoho Customer ID.
 * @param {number} amount - Invoice amount.
 * @param {string} currency - Currency code (e.g., "USD", "INR").
 * @returns {Promise<string|null>} Invoice ID or null if error.
 */
async function createInvoiceInZoho(customerId, amount, currency) {
    let createdInvoiceId = null;
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    try {
        // ** ADJUST invoiceData payload based on actual Billing v1 POST /invoices request body **
        // It might require a plan_code or item_id instead of freeform line items.
        // This payload is a GUESS based on the Invoice API structure and might need significant changes.
        const invoiceData = {
            customer_id: customerId,
            // Billing API likely requires associating with a Plan or Addon,
            // rather than direct line items like Invoice API.
            // You might need to pre-configure a suitable plan/item in Zoho Billing.
            // line_items: [ // This structure might be INCORRECT for Billing API
            //     {
            //         name: "Subscription Payment",
            //         description: "Payment processed via Paddle.",
            //         rate: amount,
            //         quantity: 1
            //     }
            // ],
            // --- Example: If Billing needs a Plan Code ---
            // plan: {
            //     plan_code: "YOUR_ZOHO_BILLING_PLAN_CODE" // You need to define this plan in Zoho Billing
            // },
            // --- Example: If Billing needs Item ID ---
             line_items: [
                 {
                     item_id: "YOUR_ZOHO_BILLING_ITEM_ID", // You need to define this item in Zoho Billing
                     quantity: 1,
                     price: amount // Verify if price can be overridden here
                 }
             ],
            currency_code: currency, // Verify if this is needed or inherited from customer/plan
        };
        console.log("Sending data to Zoho Billing Invoice:", JSON.stringify(invoiceData));
        console.log("Calling URL:", ZOHO_INVOICES_API_URL);
        console.log("Using Org ID:", ZOHO_ORGANIZATION_ID);

        const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, {
            headers: {
                Authorization: AUTH_HEADER,
                "Content-Type": "application/json",
                ...ORG_HEADER,
            },
        });

        // ** ADJUST response parsing based on actual Billing v1 POST /invoices response **
        // Assuming 'invoice_id' and 'invoice_number' exist in the response.
        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message);
            console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
        } else {
            console.error("Invoice created but ID not found in response", JSON.stringify(response.data));
        }

    } catch (error) {
        if (error.response) {
            console.error("Error creating invoice in Zoho Billing - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
        } else {
            console.error("Error creating invoice in Zoho Billing:", error.message);
        }
    }
    return createdInvoiceId;
}

/**
 * Emails an existing Zoho Invoice using Billing API.
 * @param {string} invoiceId - Zoho Invoice ID.
 * @param {string} recipientEmail - Email address to send to.
 */
async function emailZohoInvoice(invoiceId, recipientEmail) {
    if (!invoiceId || !recipientEmail) {
        console.error("Cannot email invoice: Missing invoiceId or recipientEmail.");
        return;
    }
    // ** UPDATED for Billing API v1 **
    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices/${invoiceId}/email`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    // ** UPDATED Header Name **
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    try {
        console.log(`Attempting to email invoice ${invoiceId} to ${recipientEmail}`);
        // ** ADJUST emailPayload based on actual Billing v1 POST /invoices/{id}/email request body **
        // It might just need recipient emails or might allow subject/body customization.
        const emailPayload = {
            to_mail_ids: [recipientEmail],
            // subject: "Your Invoice from Autobot", // Verify if customizable
            // body: "Thank you..." // Verify if customizable
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
 * Handles the 'transaction.completed' event from Paddle.
 * @param {object} eventData - The full event data from Paddle webhook.
 */
async function handleTransactionCompleted(eventData) {
    try {
        const transactionId = eventData.data?.id;
        const occurredAt = eventData.data?.occurred_at;
        const paddleCustomerId = eventData.data?.customer_id;

        console.log(`Processing transaction.completed: ${transactionId}`);

        if (!paddleCustomerId) {
            console.error(`ERROR: Paddle Customer ID missing in webhook data for TxID ${transactionId}. Cannot fetch details.`);
            return;
        }

        // Step 1: Fetch Customer Details from Paddle API
        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

        // Step 2: Validate Fetched Details (Especially Email)
        if (!customerDetails || !customerDetails.email) {
            console.error(`ERROR: Could not retrieve valid customer email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Aborting.`);
            return;
        }

        // Step 3: Use Fetched Details
        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail; // Fallback to email if name is null
        console.log(`Successfully retrieved from Paddle API: Email=${customerEmail}, Name=${customerName}`);

        // Step 4: Extract Amount & Currency from Webhook
        let amount = 0;
        const amountFromPaddle = eventData.data?.payments?.[0]?.amount;
        if (amountFromPaddle) {
            const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0;
            } else {
               console.error(`Could not parse amount string: "${amountFromPaddle}" for transaction ${transactionId}`);
            }
        } else {
          console.warn(`Amount not found in payments array for transaction ${transactionId}. Check Paddle payload structure.`);
        }
        const currency = eventData.data?.currency_code;
        if (!currency) {
            console.error(`Currency code missing for transaction ${transactionId}.`);
        }

        // Step 5: Main Zoho Logic (Using Billing API)
        console.log(`Handling transaction: Customer=${customerEmail}, Name=${customerName}, TxID=${transactionId}, Amount=${amount} ${currency}`);

        if (!customerEmail || amount <= 0 || !currency) {
            console.error(`Missing required data before calling Zoho functions for TxID ${transactionId}. Aborting.`);
            return;
        }

        // Use the refactored function for Zoho Billing
        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        if (zohoCustomerId) {
            // Use the refactored function for Zoho Billing
            // ** NOTE: This might require a plan_code or item_id instead of amount **
            // ** You MUST adjust createInvoiceInZoho and its call if needed **
            const invoiceId = await createInvoiceInZoho(zohoCustomerId, amount, currency);

            if (invoiceId) {
                console.log(`Invoice ${invoiceId} created successfully in Zoho Billing for TxID ${transactionId}.`);
                console.log(`Attempting to email invoice ${invoiceId} to ${customerEmail} for TxID ${transactionId}.`);
                // Use the refactored function for Zoho Billing
                await emailZohoInvoice(invoiceId, customerEmail);
            } else {
                console.error(`Invoice creation failed in Zoho Billing for TxID ${transactionId}. Email not sent.`);
            }
        } else {
            console.error(`Could not find or create Zoho Billing customer for ${customerEmail}. Invoice not created for TxID ${transactionId}.`);
        }

    } catch (error) {
        console.error("Error in handleTransactionCompleted:", error);
    }
}

// --- Webhook Endpoint ---
app.post("/paddle-webhook", async (req, res) => {
    console.log(`--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`);
    try {
        const eventData = req.body;
        console.log(">>> Paddle Webhook Received Data:", JSON.stringify(eventData, null, 2));

        const eventType = eventData?.event_type;
        console.log(`Received Paddle event type: ${eventType}`);

        if (eventType === "transaction.completed") {
            handleTransactionCompleted(eventData).catch(err => {
                console.error("Error processing transaction completed handler:", err);
            });
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
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY environment variable not set.");
});
