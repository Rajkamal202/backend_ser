const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

app.use(express.json());

// Config variables
const ZOHO_API_BASE_URL = process.env.ZOHO_API_URL?.trim() || "https://www.zohoapis.com";
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN?.trim();
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID?.trim();
const PADDLE_API_KEY = process.env.PADDLE_API_KEY?.trim();
const PADDLE_API_BASE_URL = process.env.PADDLE_SANDBOX_API_URL?.trim() || "https://sandbox-api.paddle.com";


// Mappings
const PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP = {
    "pri_01js3tjscp3sqvw4h4ngqb5d6h": "6250588000000100001",
    "pri_01js3ty4vadz3hxn890a9yvax1": "6250588000000100001",
    "pri_01js3v0bh5yfs8k7gt4ya5nmwt": "6250588000000100001"

};


// Paddle API Function
async function getPaddleCustomerDetails(paddleCustomerId) {
    if (!paddleCustomerId) {
        console.error("Need Paddle Customer ID.");
        return null;
    }
    if (!PADDLE_API_KEY) {
        console.error("PADDLE_API_KEY missing.");
        return null;
    }

    const PADDLE_CUSTOMER_URL = `${PADDLE_API_BASE_URL}/customers/${paddleCustomerId}`;
    console.log(`Calling Paddle API: ${PADDLE_CUSTOMER_URL}`);

    try {
        const response = await axios.get(PADDLE_CUSTOMER_URL, {
            headers: { Authorization: `Bearer ${PADDLE_API_KEY}`, "Content-Type": "application/json" },
        });

        const email = response.data?.data?.email;
        const name = response.data?.data?.name;

        if (!email) {
            console.warn(`Email missing in Paddle response for ${paddleCustomerId}.`);
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

// Zoho API Function: Find or Create Customer
async function getZohoCustomerId(email, name) {
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/customers`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    if (!email) {
        console.error("Email needed.");
        return null;
    }

    const customerDisplayName = name || email;
    const searchParams = { search_text: email };

    const createCustomer = async () => {
        console.log(`Attempting to create customer: ${customerDisplayName}...`);
        const createPayload = { display_name: customerDisplayName, email: email };
        console.log("Creating Zoho customer payload:", JSON.stringify(createPayload));

        const createUrl = ZOHO_CUSTOMERS_API_URL;

        console.log("--- Outgoing Zoho POST Customer Create Request ---");
        console.log(` URL: ${createUrl}`);
        const logHeaders = {
             Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`,
             ...ORG_HEADER
        };
        console.log(` Headers: ${JSON.stringify(logHeaders)}`);
        console.log(` Body: ${JSON.stringify(createPayload)}`);
        console.log("-------------------------------------------------");

        try {
            const createResponse = await axios.post(createUrl, createPayload, {
                headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" },
            });
            if (createResponse.data?.customer?.customer_id) {
                const newCustomerId = createResponse.data.customer.customer_id;
                console.log(`Successfully created Zoho customer. ID: ${newCustomerId}`);
                return newCustomerId;
            } else {
                console.error("Failed to create Zoho customer, bad response data:", JSON.stringify(createResponse.data));
                return null;
            }
        } catch (createError) {
            console.error("Error creating Zoho customer - Status:", createError.response?.status);
            console.error("Data:", JSON.stringify(createError.response?.data || createError.message));
            return null;
        }
    };

    try {
        console.log(`Searching Zoho Billing customer by email: ${email}`);

        console.log("--- Outgoing Zoho GET Customer Search Request ---");
        const fullSearchUrlWithParams = `${ZOHO_CUSTOMERS_API_URL}?${new URLSearchParams(searchParams).toString()}`;
        console.log(` Full URL w/ params: ${fullSearchUrlWithParams}`);
        const logHeaders = {
             Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`,
             ...ORG_HEADER
        };
        console.log(` Headers: ${JSON.stringify(logHeaders)}`);
        console.log("------------------------------------------------");

        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER },
            params: searchParams,
        });

        if (searchResponse.data?.customers?.length > 0) {
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
            console.log(`Search returned 200 OK but found no customers for email ${email}.`);
            return await createCustomer();
        }

    } catch (searchError) {
         console.error("Error during Zoho customer search:");
         console.error(" Status:", searchError.response?.status);
         console.error(" Data:", JSON.stringify(searchError.response?.data || searchError.message));

         const isSpecific400Error = searchError.response?.status === 400 &&
                                    searchError.response?.data?.message === "The request passed is not valid.";

         if (isSpecific400Error) {
             console.warn(`Received specific 400 error on search. Treating as "customer not found" and attempting to create.`);
             return await createCustomer();
         } else {
             console.error(`Received unhandled error status ${searchError.response?.status} during search. Aborting customer lookup.`);
             return null;
         }
    }
}

// Zoho API Function: Create Invoice
async function createInvoiceInZoho(customerId, paddlePriceId, amount, currency) {
    let createdInvoiceId = null;
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/invoices`;

    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    const zohoProductId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId];

    if (!zohoProductId || typeof zohoProductId !== 'string' || zohoProductId.length === 0 || zohoProductId.startsWith("6250588000000XXX") || zohoProductId.startsWith("6250588000000YYYYYY") || zohoProductId.startsWith("6250588000000ZZZZZZ")) {
        console.error(`Error creating invoice: Invalid, missing, or placeholder Zoho PRODUCT ID found for Paddle Price ID: "${paddlePriceId}". Looked up value: "${zohoProductId}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP.`);
        return null;
    }

    const invoiceData = {
        customer_id: customerId,
        invoice_items: [
            {
                product_id: zohoProductId,
                quantity: 1,
                price: amount
            }
        ],
        currency_code: currency,
        date: new Date().toISOString().split('T')[0],
        reference_number: paddlePriceId
    };

    try {
        console.log("Sending data to Zoho Billing Invoice:", JSON.stringify(invoiceData));
        console.log("Calling URL:", ZOHO_INVOICES_API_URL);

        const headers = { Authorization: AUTH_HEADER, "Content-Type": "application/json", ...ORG_HEADER };

        const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, { headers });

        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message);
            console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
        } else {
            console.error("Invoice created but ID missing in response", JSON.stringify(response.data));
        }
    } catch (error) {
        console.error("Error creating Zoho Billing invoice - Status:", error.response?.status);
        console.error("Data:", JSON.stringify(error.response?.data || error.message));
    }

    return createdInvoiceId;
}

// Zoho API Function: Email Invoice
async function emailZohoInvoice(invoiceId, recipientEmail) {
    if (!invoiceId || !recipientEmail) {
        console.error("Cannot email invoice: Missing ID or Email.");
        return;
    }

    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/invoices/${invoiceId}/email`;
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = { "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID };

    const emailPayload = {
        to_mail_ids: [recipientEmail],
        subject: `Your Invoice from [Your Company Name]`, // Customize this
        body: `Dear Customer,\n\nPlease find your invoice attached for your recent purchase.\n\nThank you for your business!`, // Customize this
        attach_pdf: true,
    };

    try {
        console.log(`Trying email invoice ${invoiceId} to ${recipientEmail}`);
        console.log("Sending Email Payload:", JSON.stringify(emailPayload));

        const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER, "Content-Type": "application/json" },
        });

        console.log(`Email Invoice Response for ${invoiceId}:`, response.data?.message || JSON.stringify(response.data));
        if (response.data?.code === 0 || response.data?.message === 'Invoice emailed successfully.') {
            console.log(`Successfully emailed invoice ${invoiceId}.`);
        } else {
            console.warn(`Emailing invoice ${invoiceId} might not have been successful. Response:`, JSON.stringify(response.data));
        }
    } catch (error) {
        console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response?.status);
        console.error("Data:", JSON.stringify(error.response?.data || error.message));
    }
}

// Webhook Handler
async function handleTransactionCompleted(eventData) {
    console.log(`--- Processing transaction.completed webhook ---`);
    try {
        const transactionId = eventData.data?.id;
        const occurredAt = eventData.data?.occurred_at;
        const paddleCustomerId = eventData.data?.customer_id;
        const paddlePriceId = eventData.data?.items?.[0]?.price?.id;

        console.log(`Processing transaction: ID=${transactionId}, OccurredAt=${occurredAt}, PaddleCustomerID=${paddleCustomerId}, PaddlePriceID=${paddlePriceId}`);

        if (!paddleCustomerId || !paddlePriceId) {
            console.error(`ERROR: Missing Paddle Customer ID or Price ID in webhook for TxID ${transactionId}. Cannot continue.`);
            return;
        }

        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

        if (!customerDetails || !customerDetails.email) {
            console.error(`ERROR: No email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Stopping.`);
            return;
        }

        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail;
        console.log(`Got from Paddle API: Email=${customerEmail}, Name=${customerName}`);

        let amount = 0;
        const paymentInfo = eventData.data?.payments?.[0];
        const amountFromPaddle = paymentInfo?.amount;
        const currency = eventData.data?.currency_code;

        if (amountFromPaddle) {
            const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0;
                console.log(`Converted amount from Paddle (cents) to base unit: ${amount}`);
            } else {
                console.error(`Bad amount format from webhook: "${amountFromPaddle}" for TxID ${transactionId}`);
                return;
            }
        } else {
            console.error(`ERROR: Amount missing in webhook for TxID ${transactionId}. Cannot create invoice.`);
            return;
        }

        if (!currency) {
             console.error(`ERROR: Currency missing for TxID ${transactionId}. Cannot create invoice.`);
             return;
        }

        console.log(`Amount: ${amount} ${currency}`);

        const zohoItemId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId];
        const zohoProductIdForInvoice = zohoItemId;

        if (!zohoProductIdForInvoice || typeof zohoProductIdForInvoice !== 'string' || zohoProductIdForInvoice.length === 0 || zohoProductIdForInvoice.startsWith("6250588000000XXX") || zohoProductIdForInvoice.startsWith("6250588000000YYYYYY") || zohoProductIdForInvoice.startsWith("6250588000000ZZZZZZ")) {
             console.error(`ERROR: Could not find valid Zoho PRODUCT ID mapping for Paddle Price ID "${paddlePriceId}". Looked up value: "${zohoProductIdForInvoice}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP.`);
             return;
        }
        console.log(`Mapped Paddle Price ID "${paddlePriceId}" to Zoho PRODUCT ID "${zohoProductIdForInvoice}"`);


        console.log(`Initiating Zoho process: Customer=${customerEmail}, TxID=${transactionId}, ProductID=${zohoProductIdForInvoice}, Amount=${amount} ${currency}`);

        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        if (zohoCustomerId) {
            const invoiceId = await createInvoiceInZoho(zohoCustomerId, paddlePriceId, amount, currency);

            if (invoiceId) {
                console.log(`Invoice ${invoiceId} created in Zoho Billing for TxID ${transactionId}.`);
                console.log(`Trying email invoice ${invoiceId} to ${customerEmail} for TxID ${transactionId}.`);
                await emailZohoInvoice(invoiceId, customerEmail);
            } else {
                console.error(`Zoho invoice creation failed for TxID ${transactionId}. Email not sent.`);
            }
        } else {
            console.error(`Zoho customer step failed for ${customerEmail}. Invoice not created for TxID ${transactionId}.`);
        }
    } catch (error) {
        console.error("Unhandle Error in handleTransactionCompleted:", error);
    } finally {
         console.log(`--- Finished processing transaction.completed webhook ---`);
    }
}

// Express Webhook Endpoint
app.post("/paddle-webhook", async (req, res) => {
    console.log(`--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`);

    try {
        const eventData = req.body;

        // WARNING: Verify the webhook signature in production!

        console.log(">>> Paddle Webhook Received Data:", JSON.stringify(eventData, null, 2));

        const eventType = eventData?.event_type;
        const transactionId = eventData.data?.id;

        console.log(`Received Paddle event type: ${eventType} (TxID: ${transactionId})`);

        if (eventType === "transaction.completed") {
            handleTransactionCompleted(eventData).catch((err) => {
                console.error(`Error processing transaction completed handler for TxID ${transactionId}:`, err);
            });
            res.status(200).send(`Webhook received and processing for ${eventType} initiated.`);
        } else {
            console.log(`Unhandled event type: ${eventType} (TxID: ${transactionId})`);
            res.status(200).send(`Webhook received, unhandled event type: ${eventType}`);
        }
    } catch (error) {
        console.error("Error receiving or processing webhook:", error);
        res.status(500).send("Internal Server Error during webhook reception");
    }
});

// Server Start
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    console.log(`--- Environment Variables Loaded ---`);
    console.log(` ZOHO_API_BASE_URL: ${ZOHO_API_BASE_URL}`);
    console.log(` PADDLE_API_BASE_URL: ${PADDLE_API_BASE_URL}`);
    console.log(` ZOHO_OAUTH_TOKEN (first 10 chars): ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`);
    console.log(` ZOHO_ORGANIZATION_ID: ${ZOHO_ORGANIZATION_ID}`);
    console.log(` PADDLE_API_KEY (present): ${!!PADDLE_API_KEY}`);
    console.log(`------------------------------------`);

    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
    if (!PADDLE_API_BASE_URL) console.warn("Warning: PADDLE_API_BASE_URL missing.");
    if (!PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP || Object.keys(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).length === 0) {
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP is empty or missing. Invoice creation will fail.");
    } else if (Object.values(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).some(id => id.startsWith("6250588000000XXX") || id.startsWith("6250588000000YYYYYY") || id.startsWith("6250588000000ZZZZZZ"))) {
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP contains placeholder IDs. Replace them with actual Zoho Product IDs.");
    }
});
