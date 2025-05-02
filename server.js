const express = require("express");
const axios = require("axios");
const path = require('path');
const app = express();
require('dotenv').config();

app.use(express.json({
    verify: (req, res, buf, encoding) => {
        if (buf && buf.length) {
            req.rawBody = buf.toString(encoding || 'utf8');
        }
    }
}));
app.use(express.static('public'));

const ZOHO_API_BASE_URL = process.env.NODE_ENV === 'production'
    ? "https://www.zohoapis.com"
    : "https://sandbox.zohoapis.com"; 

const ZOHO_BILLING_API_VERSION_PATH = "/billing/v1";

// Zoho Accounts Token Endpoint URL for US Datacenter
const ZOHO_TOKEN_URL = "https://accounts.zoho.com/oauth/v2/token"; // Correct US URL

// Load credentials from .env file
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; // Manually updated Access Token
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID; // Use correct ID for Sandbox or Prod
const PADDLE_API_KEY = process.env.PADDLE_API_KEY; // Use correct key for Sandbox or Prod
const PADDLE_API_BASE_URL = process.env.NODE_ENV === 'production'
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";


// --- Mappings (MUST BE FILLED BY YOU) ---
const PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP = {
    // !! REPLACE placeholders with your actual Paddle Price IDs and Zoho Item IDs !!
    "pri_01js3tjscp3sqvw4h4ngqb5d6h": "YOUR_ZOHO_ITEM_ID_FOR_STARTER",
    "pri_01js3ty4vadz3hxn890a9yvax1": "YOUR_ZOHO_ITEM_ID_FOR_PRO",
    "pri_01js3v0bh5yfs8k7gt4ya5nmwt": "YOUR_ZOHO_ITEM_ID_FOR_ENTERPRISE"
};
// --- End Mappings ---


// --- Helper Functions ---

/**
 * Get customer details from Paddle using customer ID.
 */
async function getPaddleCustomerDetails(paddleCustomerId) {
    // (Code remains the same)
    if (!paddleCustomerId) { console.error("getPaddleCustomerDetails: Need Paddle Customer ID."); return null; }
    if (!PADDLE_API_KEY) { console.error("getPaddleCustomerDetails: PADDLE_API_KEY missing."); return null; }
    const PADDLE_CUSTOMER_URL = `${PADDLE_API_BASE_URL}/customers/${paddleCustomerId}`;
    console.log(`Calling Paddle API: ${PADDLE_CUSTOMER_URL}`);
    try {
        const response = await axios.get(PADDLE_CUSTOMER_URL, { headers: { 'Authorization': `Bearer ${PADDLE_API_KEY}`, 'Content-Type': 'application/json' } });
        const email = response.data?.data?.email;
        const name = response.data?.data?.name;
        if (!email) { console.warn(`getPaddleCustomerDetails: Email missing in Paddle response.`); }
        console.log(`Got Paddle details: Email: ${email}, Name: ${name}`);
        return { email, name };
    } catch (error) {
        console.error(`Error getting Paddle customer ${paddleCustomerId}`);
        if (error.response) { console.error("Paddle API Error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data)); }
        else { console.error("Paddle API Error:", error.message); }
        return null;
    }
}


/**
 * Find/Create Zoho customer using Billing API.
 */
async function getZohoCustomerId(email, name) {
    // Uses ZOHO_API_BASE_URL which should now point to sandbox.zohoapis.com for testing
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/customers`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };
    if (!email) { console.error("getZohoCustomerId: Email needed."); return null; }
    const customerDisplayName = name || email;
    try {
        console.log(`Searching Zoho Billing customer: ${email}`);
        // Use correct US Sandbox URL now
        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER },
            params: { email: email }
        });
        // ** WARNING: Check Zoho Billing docs for correct response structure! **
        if (searchResponse.data?.customers?.length > 0) {
            const customerId = searchResponse.data.customers[0].customer_id; // Check field name
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
             console.log(`Customer not found, creating: ${customerDisplayName}...`);
             // ** WARNING: Check Billing docs for correct POST /customers fields! **
             const createPayload = { display_name: customerDisplayName, email: email };
             console.log("Creating Zoho customer payload:", JSON.stringify(createPayload));
             try {
                 const createResponse = await axios.post(ZOHO_CUSTOMERS_API_URL, createPayload, {
                     headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" }
                 });
                 // ** WARNING: Check Billing docs for correct response structure! **
                 if (createResponse.data?.customer?.customer_id) {
                     const newCustomerId = createResponse.data.customer.customer_id;
                     console.log(`Created Zoho customer. ID: ${newCustomerId}`);
                     return newCustomerId;
                 } else { console.error("Failed create Zoho customer, bad response:", JSON.stringify(createResponse.data)); return null; }
             } catch (createError) {
                 console.error("Error creating Zoho customer - Status:", createError.response?.status, "Data:", JSON.stringify(createError.response?.data || createError.message));
                 return null;
             }
        }
    } catch (searchError) {
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
                 } else { console.error("Failed create after 404, bad response:", JSON.stringify(createResponse.data)); return null; }
             } catch (createError) { console.error("Error creating Zoho customer after 404 - Status:", createError.response?.status, "Data:", JSON.stringify(createError.response?.data || createError.message)); return null; }
        } else {
             // Other errors (like the 400 Bad Request we are seeing)
             console.error("Error searching Zoho customer - Status:", searchError.response?.status, "Data:", JSON.stringify(searchError.response?.data || searchError.message));
             return null;
        }
    }
}

/**
 * Create invoice in Zoho Billing using Zoho Item ID.
 */
async function createInvoiceInZoho(customerId, zohoItemId, amount, currency) {
    let createdInvoiceId = null;
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };
    if (!zohoItemId || zohoItemId.startsWith("YOUR_ZOHO_ITEM_ID_")) { console.error(`Error creating invoice: Invalid Zoho Item ID: ${zohoItemId}.`); return null; }
    try {
        // ** WARNING: Check Zoho Billing v1 docs for POST /invoices payload structure! **
        const invoiceData = {
            customer_id: customerId,
             line_items: [ { item_id: zohoItemId, quantity: 1 } ]
             // Add 'currency_code': currency ONLY if docs say it's needed
        };
        console.log("Sending data to Zoho Billing Invoice:", JSON.stringify(invoiceData));
        console.log("Calling URL:", ZOHO_INVOICES_API_URL); // Will use sandbox.zohoapis.com for testing
        const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" }
        });
        // ** WARNING: Check Billing docs for correct response structure! **
        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message);
            console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
        } else { console.error("Invoice created but ID missing in response", JSON.stringify(response.data)); }
    } catch (error) {
        console.error("Error creating Zoho Billing invoice - Status:", error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
    return createdInvoiceId;
}

/**
 * Email invoice from Zoho Billing.
 */
async function emailZohoInvoice(invoiceId, recipientEmail) {
    if (!invoiceId || !recipientEmail) { console.error("Cannot email invoice: Missing ID or Email."); return; }
    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/invoices/${invoiceId}/email`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };
    try {
        console.log(`Trying email invoice ${invoiceId} to ${recipientEmail}`);
        // ** WARNING: Check Billing docs for correct email payload! **
        const emailPayload = { to_mail_ids: [recipientEmail] };
        console.log("Sending Email Payload:", JSON.stringify(emailPayload));
        const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" }
        });
        console.log(`Email Invoice Response for ${invoiceId}:`, response.data?.message || JSON.stringify(response.data));
    } catch (error) {
         console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response?.status, "Data:", JSON.stringify(error.response?.data || error.message));
    }
}

// **** Function to get plans from Zoho Billing ****
/**
 * Gets active plans from Zoho Billing API. Adds Paddle Price ID.
 * NOTE: This function is optional if frontend is static or uses Zoho Widget.
 */
async function getZohoBillingPlans() {
    const ZOHO_PLANS_API_URL = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/plans`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };
    const config = { headers: { Authorization: AUTH_HEADER, ...ORG_HEADER }, params: { status: 'active' } }; // Check filter
    console.log("Fetching active plans from Zoho Billing...");
    try {
        const response = await axios.get(ZOHO_PLANS_API_URL, config );
        // ** WARNING: Check Billing docs for correct response structure! **
        if (response.data?.plans) {
            console.log(`Got ${response.data.plans.length} plans from Zoho.`);
            const plansWithPaddleId = response.data.plans.map(plan => {
                // ** Using item_id for mapping now **
                const paddlePriceId = ZOHO_ITEM_ID_TO_PADDLE_PRICE_ID_MAP[plan.item_id]; // Use item_id map
                if (!paddlePriceId || paddlePriceId.startsWith("pri_paddle_")) {
                    console.warn(`Warning: No Paddle Price ID map found for Zoho Item ID: ${plan.item_id} (Plan: ${plan.name})`);
                }
                // ** WARNING: Verify these field names from Zoho GET /plans response! **
                return {
                    zoho_item_id: plan.item_id,
                    name: plan.name,
                    description: plan.description,
                    price: plan.recurring_price, // GUESS
                    currency_code: plan.currency_code, // GUESS
                    interval: plan.interval, // GUESS
                    paddle_price_id: paddlePriceId || null
                };
            }).filter(plan => plan.paddle_price_id && !plan.paddle_price_id.startsWith("pri_paddle_"));
            return plansWithPaddleId;
        } else {
            console.error("Could not find 'plans' array in Zoho Billing response:", JSON.stringify(response.data));
            return null;
        }
    } catch (error) {
        console.error("Failed to fetch Zoho Billing plans.");
        if (error.response) { console.error("Error Status:", error.response.status, "Data:", JSON.stringify(error.response.data)); }
        else { console.error("Error:", error.message); }
        return null;
    }
}


/**
 * Main function for handling Paddle 'transaction.completed' webhook.
 */
async function handleTransactionCompleted(eventData) {
    try {
        const transactionId = eventData.data?.id;
        const paddleCustomerId = eventData.data?.customer_id;
        console.log(`Processing transaction.completed: ${transactionId}`);
        if (!paddleCustomerId) { console.error(`ERROR: No Paddle Customer ID...`); return; }

        // Step 1: Get Paddle details
        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);
        if (!customerDetails || !customerDetails.email) { console.error(`ERROR: No email from Paddle API...`); return; }

        // Step 3: Use details
        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail;
        console.log(`Got from Paddle API: Email=${customerEmail}, Name=${customerName}`);

        // Step 4: Get transaction details
        let amount = 0;
        const paymentInfo = eventData.data?.payments?.[0];
        const amountFromPaddle = paymentInfo?.amount;
        const paddlePriceId = eventData.data?.items?.[0]?.price?.id;
        if (amountFromPaddle) { amount = parseInt(amountFromPaddle, 10) / 100.0; }
        else { console.warn(`Amount missing...`); }
        const currency = eventData.data?.currency_code;
        if (!currency) { console.error(`Currency missing...`); }
        if (!paddlePriceId) { console.error(`ERROR: Paddle Price ID missing...`); return; }
        console.log(`Paddle Price ID found: ${paddlePriceId}`);

        // Step 5: Map to Zoho Item ID
        const zohoItemId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId];
        if (!zohoItemId || zohoItemId.startsWith("YOUR_ZOHO_ITEM_ID_")) { console.error(`ERROR: Could not find Zoho Item ID mapping...`); return; }
        console.log(`Mapped to Zoho Item ID: ${zohoItemId}`);

        // Step 6: Call Zoho functions
        console.log(`Handling transaction: ... ZohoItemID=${zohoItemId}`);
        if (!customerEmail || amount <= 0 || !currency || !zohoItemId) { console.error(`Missing required data before Zoho calls...`); return; }

        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        if (zohoCustomerId) {
            // Pass zohoItemId
            const invoiceId = await createInvoiceInZoho(zohoCustomerId, zohoItemId, amount, currency);
            if (invoiceId) {
                console.log(`Invoice ${invoiceId} created...`);
                await emailZohoInvoice(invoiceId, customerEmail);
            } else { console.error(`Zoho invoice creation failed...`); }
        } else { console.error(`Zoho customer step failed...`); }

    } catch (error) { console.error("Error in handleTransactionCompleted:", error.message); }
}

// --- Webhook Endpoint ---
app.post("/paddle-webhook", async (req, res) => {
    console.log(`--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`);
    try {
        // Add signature verification here if needed later

        const eventData = req.body;
        console.log(">>> Paddle Webhook Received Data:", JSON.stringify(eventData, null, 2));
        const eventType = eventData?.event_type;
        console.log(`Received Paddle event type: ${eventType}`);
        if (eventType === "transaction.completed") {
            handleTransactionCompleted(eventData).catch(err => { console.error("Error processing handler:", err); });
            res.status(200).send("Webhook received successfully, processing initiated.");
        } else {
            console.log(`Unhandled event type: ${eventType}`);
            res.status(200).send(`Webhook received, unhandled event type: ${eventType}`);
        }
    } catch (error) {
        console.error("Error processing webhook:", error);
        res.status(500).send("Internal Server Error");
    }
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Check essential env vars
    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
});
