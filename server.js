const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config(); 

app.use(express.json());

const ZOHO_API_BASE_URL = "https://sandbox.zohoapis.in";
const ZOHO_BILLING_API_VERSION_PATH = "/billing/v1"; 
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; 
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID; 
const PADDLE_API_KEY = process.env.PADDLE_API_KEY; 

const PADDLE_TO_ZOHO_PLAN_MAP = {
    "pri_01js3tjscp3sqvw4h4ngqb5d6h": "starter_yearly",
    "pri_01js3ty4vadz3hxn890a9yvax1": "pro_yearly",
    "pri_01js3v0bh5yfs8k7gt4ya5nmwt": "enterprise_yearly"
};

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
        const email = response.data?.data?.email;
        const name = response.data?.data?.name;
        if (!email) {
             console.warn(`getPaddleCustomerDetails: Email missing in Paddle response for ${paddleCustomerId}.`);
        }
        console.log(`Got Paddle details: Email: ${email}, Name: ${name}`);
        return { email, name };
    } catch (error) {
        console.error(`Error getting Paddle customer ${paddleCustomerId}`);
        if (error.response) {
           console.error("Paddle API Error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
        } else {
           console.error("Paddle API Error:", error.message);
        }
        return null;
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
    if (!email) {
        console.error("getZohoCustomerId: Email needed.");
        return null;
    }
    const customerDisplayName = name || email;
    try {
        console.log(`Searching Zoho Billing customer: ${email}`);
        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER },
            params: { email: email }
        });
        // Check response if customer found
        if (searchResponse.data?.customers?.length > 0) {
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
            // Customer not found, try to create
            console.log(`Customer not found, creating: ${customerDisplayName}...`);
            const createPayload = { display_name: customerDisplayName, email: email }; 
            console.log("Creating Zoho customer payload:", JSON.stringify(createPayload));
            try {
                const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, {
                    headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" }
                });
                // Check response if customer created and ID returned
                if (createResponse.data?.customer?.customer_id) {
                    const newCustomerId = createResponse.data.customer.customer_id;
                    console.log(`Created Zoho customer. ID: ${newCustomerId}`);
                    return newCustomerId;
                } else {
                    console.error("Failed create Zoho customer, bad response:", JSON.stringify(createResponse.data));
                    return null;
                }
            } catch (createError) {
                console.error("Error creating Zoho customer - Status:", createError.response?.status, "Data:", JSON.stringify(createError.response?.data || createError.message));
                return null;
            }
        }
    } catch (searchError) {
        // Handle 404 as 'not found' and try creating
        if (searchError.response && searchError.response.status === 404) {
             console.log(`Zoho customer search 404 for ${email}, try create.`);
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
 * Create invoice in Zoho Billing using specific Zoho Plan Code.
 * Need Zoho customer ID, Zoho Plan Code, amount, currency.
 * Return invoice ID or null.
 */

async function createInvoiceInZoho(customerId, zohoPlanCode, amount, currency) {
    let createdInvoiceId = null;
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    // Check if we received a valid Zoho Plan Code
    if (!zohoPlanCode || zohoPlanCode.startsWith("ZOHO_PLAN_CODE_")) {
        console.error(`Error creating invoice: Invalid or missing Zoho Plan Code provided: ${zohoPlanCode}. Did you update the PADDLE_TO_ZOHO_PLAN_MAP?`);
        return null;
    }

    try {

        // This structure using 'plan' is a COMMON PATTERN but needs verification.
        const invoiceData = {
            customer_id: customerId,

            plan: {
                 plan_code: zohoPlanCode // Use the specific Plan Code passed to the function
            },
        };
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
        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message);
            console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
        } else {
            console.error("Invoice created but ID missing in response", JSON.stringify(response.data));
        }

    } catch (error) {
        console.error("Error creating Zoho Billing invoice - Status:", error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
    return createdInvoiceId;
}

/**
 * Email invoice from Zoho Billing.
 * Need invoice ID and recipient email.
 */
async function emailZohoInvoice(invoiceId, recipientEmail) {
    if (!invoiceId || !recipientEmail) {
        console.error("Cannot email invoice: Missing ID or Email.");
        return;
    }
    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices/${invoiceId}/email`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };
    try {
        console.log(`Trying email invoice ${invoiceId} to ${recipientEmail}`);
        const emailPayload = {
            to_mail_ids: [recipientEmail],
        };
        console.log("Sending Email Payload:", JSON.stringify(emailPayload));
        const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" }
        });
        console.log(`Email Invoice Response for ${invoiceId}:`, response.data?.message || JSON.stringify(response.data));
    } catch (error) {
         console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
}


/**
 * Main function to handle Paddle 'transaction.completed' webhook.
 */
async function handleTransactionCompleted(eventData) {
    try {
        const transactionId = eventData.data?.id;
        const occurredAt = eventData.data?.occurred_at;
        const paddleCustomerId = eventData.data?.customer_id;

        console.log(`Processing transaction.completed: ${transactionId}`);

        if (!paddleCustomerId) {
            console.error(`ERROR: No Paddle Customer ID in webhook for TxID ${transactionId}. Cannot continue.`);
            return;
        }

        // --- Step 1: Get customer details from Paddle ---
        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

        // --- Step 2: Check if email received from Paddle ---
        if (!customerDetails || !customerDetails.email) {
            console.error(`ERROR: No email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Stopping.`);
            return;
        }

        // --- Step 3: Use Paddle details ---
        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail;
        console.log(`Got from Paddle API: Email=${customerEmail}, Name=${customerName}`);

        // --- Step 4: Get amount, currency, AND PADDLE PRICE ID from webhook ---
        let amount = 0;
        const paymentInfo = eventData.data?.payments?.[0];
        const amountFromPaddle = paymentInfo?.amount;
        const paddlePriceId = eventData.data?.items?.[0]?.price?.id; // Check this path

        if (amountFromPaddle) {
            const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0;
            } else {
               console.error(`Bad amount format: "${amountFromPaddle}" for TxID ${transactionId}`);
            }
        } else {
          console.warn(`Amount missing in webhook for TxID ${transactionId}.`);
        }
        const currency = eventData.data?.currency_code;
        if (!currency) {
            console.error(`Currency missing for TxID ${transactionId}.`);
        }
        if (!paddlePriceId) {
            console.error(`ERROR: Paddle Price ID missing in webhook data for TxID ${transactionId}. Cannot map to Zoho Plan.`);
            return;
        }
         console.log(`Paddle Price ID found: ${paddlePriceId}`);

        // --- Step 5: Map Paddle Price ID to Zoho Plan Code
        const zohoPlanCode = PADDLE_TO_ZOHO_PLAN_MAP[paddlePriceId]; 
        if (!zohoPlanCode || zohoPlanCode.startsWith("ZOHO_PLAN_CODE_")) { 
             console.error(`ERROR: Could not find Zoho Plan Code mapping for Paddle Price ID ${paddlePriceId}. Check PADDLE_TO_ZOHO_PLAN_MAP.`);
             return;
        }
        console.log(`Mapped to Zoho Plan Code: ${zohoPlanCode}`); 

        // --- Step 6: Call Zoho functions ---
        console.log(`Handling transaction: Customer=${customerEmail}, Name=${customerName}, TxID=${transactionId}, Amount=${amount} ${currency}, ZohoPlanCode=${zohoPlanCode}`); // MODIFIED Log

        if (!customerEmail || amount <= 0 || !currency || !zohoPlanCode) { // MODIFIED Check
            console.error(`Missing required data before Zoho calls for TxID ${transactionId}. Stopping.`);
            return;
        }

        // Get or create Zoho customer ID
        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        // If we got Zoho customer ID...
        if (zohoCustomerId) {
            // Create Zoho invoice using the MAPPED Zoho Plan Code
            // Pass zohoPlanCode to the modified function
            const invoiceId = await createInvoiceInZoho(zohoCustomerId, zohoPlanCode, amount, currency); // Pass zohoPlanCode

            // If invoice created...
            if (invoiceId) {
                console.log(`Invoice ${invoiceId} created in Zoho Billing for TxID ${transactionId}.`);
                // Email the invoice
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

    } catch (error) {
        console.error("Error in handleTransactionCompleted:", error);
    }
}

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
});

