const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

app.use(express.json());

// --- Configuration & Constants ---
// Use the base URL without the version path, version path added in functions
const ZOHO_API_BASE_URL ="https://www.zohoapis.com"; // Use .com for USA Production
// Removed ZOHO_BILLING_API_VERSION_PATH as it's redundant with corrected ZOHO_API_BASE_URL

const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;

// --- Mappings ---
// Renamed for clarity: Paddle Price ID maps directly to Zoho Item ID for invoices
// You MUST replace the placeholder IDs with actual Zoho Item IDs from your USA Production org.
const PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP = {
    // Example: 'your_paddle_price_id_1': 'your_zoho_item_id_1',
    // Example: 'your_paddle_price_id_2': 'your_zoho_item_id_2',
    "pri_01js3tjscp3sqvw4h4ngqb5d6h": "6250588000000100001", // Placeholder Zoho Item ID
    "pri_01js3ty4vadz3hxn890a9yvax1": "6250588000000100001", // Placeholder Zoho Item ID
    "pri_01js3v0bh5yfs8k7gt4ya5nmwt": "6250588000000100001" // Placeholder Zoho Item ID
};



// --- Paddle API Function ---
async function getPaddleCustomerDetails(paddleCustomerId) {
    const PADDLE_API_BASE_URL = "https://sandbox-api.paddle.com"; // Use sandbox for testing Paddle API

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
                Authorization: `Bearer ${PADDLE_API_KEY}`,
                "Content-Type": "application/json",
            },
        });

        const email = response.data?.data?.email;
        const name = response.data?.data?.name;

        if (!email) {
            console.warn(
                `getPaddleCustomerDetails: Email missing in Paddle response for ${paddleCustomerId}.`
            );
        }

        console.log(`Got Paddle details: Email: ${email}, Name: ${name}`);

        return { email, name };
    } catch (error) {
        console.error(`Error getting Paddle customer ${paddleCustomerId}`);

        if (error.response) {
            console.error(
                "Paddle API Error - Status:",
                error.response.status,
                "Data:",
                JSON.stringify(error.response.data)
            );
        } else {
            console.error("Paddle API Error:", error.message);
        }

        return null;
    }
}

// --- Zoho API Functions ---

/**
 * Find Zoho customer using email. If not found, create new one.
 * Uses Zoho Billing API. Returns Zoho customer ID.
 */
async function getZohoCustomerId(email, name) {
    // Corrected URL using base + endpoint
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/customers`;

    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    if (!email) {
        console.error("getZohoCustomerId: Email needed.");
        return null;
    }

    const customerDisplayName = name || email;

    try {
        console.log(`Searching Zoho Billing customer by email: ${email}`);
        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER },
            // --- FIX: Use search_text parameter for email filtering ---
            params: { search_text: email },
        });

        if (searchResponse.data?.customers?.length > 0) {
            // Found customer
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
            // Customer not found, proceed to create
            console.log(`Customer not found for email ${email}, creating...`);

            const createPayload = { display_name: customerDisplayName, email: email };
            console.log(
                "Creating Zoho customer payload:",
                JSON.stringify(createPayload)
            );

            try {
                const createResponse = await axios.post(
                    ZOHO_CUSTOMERS_API_URL,
                    createPayload,
                    {
                        headers: {
                            Authorization: AUTH_HEADER,
                            ...ORG_HEADER,
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (createResponse.data?.customer?.customer_id) {
                    const newCustomerId = createResponse.data.customer.customer_id;
                    console.log(`Created Zoho customer. ID: ${newCustomerId}`);
                    return newCustomerId;
                } else {
                    console.error(
                        "Failed to create Zoho customer, bad response data:",
                        JSON.stringify(createResponse.data)
                    );
                    return null;
                }
            } catch (createError) {
                console.error(
                    "Error creating Zoho customer - Status:",
                    createError.response?.status,
                    "Data:",
                    JSON.stringify(createError.response?.data || createError.message)
                );
                return null; // Propagate error or return null on failure
            }
        }
    } catch (searchError) {
         // Log the specific error details for debugging the search failure
        console.error(
            "Error searching Zoho customer - Status:",
            searchError.response?.status,
            "Data:",
            JSON.stringify(searchError.response?.data || searchError.message)
        );
        // Important: Do NOT try to create if search fails for reasons other than "not found" (like 400, 401, 403, 500).
        // The original code tried to create on 404 search error. This is unnecessary with search_text filter,
        // as a successful search *will* return an empty 'customers' array if not found.
        // Any other search error (like 400 from wrong params, or auth errors) should stop processing.
        console.error(`Zoho customer search failed for ${email}. Aborting customer lookup.`);
        return null; // Return null on search failure
    }
}


/**
 * Create invoice in Zoho Billing.
 * Needs customer ID, item ID, amount, and currency.
 */
async function createInvoiceInZoho(customerId, paddlePriceId, amount, currency) {
    let createdInvoiceId = null;
    // Corrected URL using base + endpoint
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/invoices`;

    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    // Use the globally defined mapping
    const zohoItemId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId];

    // Validate the looked-up Item ID
    if (!zohoItemId || typeof zohoItemId !== 'string' || zohoItemId.length === 0 || zohoItemId.startsWith("6250588000000XXXXXX")) { // Check for placeholder too
        console.error(
            `Error creating invoice: Invalid, missing, or placeholder Zoho Item ID found for Paddle Price ID: "${paddlePriceId}". Looked up value: "${zohoItemId}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP.`
        );
        return null;
    }

    // --- Verify Invoice Payload Structure with Zoho Docs ---
    // Consult Zoho Books/Billing API v1 documentation for POST /invoices
    // Minimum fields usually include customer_id and line_items.
    // line_items is an array of objects. Using item_id is standard.
    // When using item_id, often quantity is needed.
    // Providing 'rate' overrides the item's standard price. If you want the Paddle amount
    // to be the exact line item total for quantity 1, include 'rate'.
    // 'plan_code' is typically NOT part of a standard invoice line item using item_id. Remove it.
    // 'currency_code' is often required at the top level.

    const invoiceData = {
        customer_id: customerId,
        line_items: [
            {
                item_id: zohoItemId, // Use the mapped item ID
                quantity: 1,         // Assuming 1 unit is purchased per transaction
                rate: amount         // Use the amount from Paddle as the rate (overrides item price)
                // DO NOT include plan_code here for standard invoices
                // Other potential fields based on docs: name, description, tax_id etc.
            }
        ],
        // Add currency code at the top level if required by docs
        currency_code: currency,
        // Add invoice date - crucial for accounting
        date: new Date().toISOString().split('T')[0], // Format YYYY-MM-DD
        // Optional: reference_number (maybe Paddle transaction ID)
        reference_number: paddlePriceId // Or Paddle transaction ID if available/suitable
    };
    // --- END PAYLOAD MODIFICATION ---

    try {
        console.log(
            "Sending data to Zoho Billing Invoice:",
            JSON.stringify(invoiceData)
        );
        console.log("Calling URL:", ZOHO_INVOICES_API_URL);

        const headers = {
            Authorization: AUTH_HEADER,
            "Content-Type": "application/json",
            ...ORG_HEADER
        };

        // Make the API call
        const response = await axios.post(ZOHO_INVOICES_API_URL, invoiceData, { headers });

        // Check response for invoice ID
        if (response.data?.invoice?.invoice_id) {
            createdInvoiceId = response.data.invoice.invoice_id;
            console.log("Invoice Creation Response:", response.data.message);
            console.log(
                "Invoice created, Number:",
                response.data.invoice.invoice_number,
                "ID:",
                createdInvoiceId
            );
        } else {
            console.error(
                "Invoice created but ID missing in response",
                JSON.stringify(response.data)
            );
        }
    } catch (error) {
        // Log detailed error information
        console.error(
            "Error creating Zoho Billing invoice - Status:",
            error.response?.status
        );
        console.error(
            "Data:",
            JSON.stringify(error.response?.data || error.message) // Log specific Zoho error message
        );
        // Optional: Log the payload that failed
        // console.error("Failed Payload:", JSON.stringify(invoiceData));
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

    // Corrected URL using base + endpoint
    const ZOHO_EMAIL_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/invoices/${invoiceId}/email`;

    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    // --- Verify Email Payload Structure with Zoho Docs ---
    // Consult Zoho Books/Billing API v1 documentation for POST /invoices/{id}/email
    // to_mail_ids is likely correct. Add subject and body for clarity, and attach_pdf.

    const emailPayload = {
        to_mail_ids: [recipientEmail],
        // --- Recommended: Add Subject and Body for a user-friendly email ---
        subject: `Your Invoice from [Your Company Name]`, // Customize this
        body: `Dear Customer,\n\nPlease find your invoice attached for your recent purchase.\n\nThank you for your business!`, // Customize this
        attach_pdf: true, // Usually want to attach the PDF
        // Other potential fields: cc_mail_ids, bcc_mail_ids, contact_ids etc.
    };
    // --- END PAYLOAD MODIFICATION ---

    try {
        console.log(`Trying email invoice ${invoiceId} to ${recipientEmail}`);
        console.log("Sending Email Payload:", JSON.stringify(emailPayload));


        const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
            headers: {
                Authorization: AUTH_HEADER,
                ...ORG_HEADER,
                "Content-Type": "application/json",
            },
        });

        console.log(
            `Email Invoice Response for ${invoiceId}:`,
            response.data?.message || JSON.stringify(response.data)
        );
         // Check for success message in response data if docs indicate one
         if (response.data?.code === 0 || response.data?.message === 'Invoice emailed successfully.') {
             console.log(`Successfully emailed invoice ${invoiceId}.`);
         } else {
             console.warn(`Emailing invoice ${invoiceId} might not have been successful. Response:`, JSON.stringify(response.data));
         }
    } catch (error) {
        console.error(
            `Error emailing invoice ${invoiceId} - Status:`,
            error.response?.status,
            "Data:",
            JSON.stringify(error.response?.data || error.message)
        );
    }
}

// --- Webhook Handler ---

/**
 * Main function to handle Paddle 'transaction.completed' webhook.
 */
async function handleTransactionCompleted(eventData) {
    console.log(`--- Processing transaction.completed webhook ---`);
    try {
        const transactionId = eventData.data?.id;
        const occurredAt = eventData.data?.occurred_at;
        const paddleCustomerId = eventData.data?.customer_id;
        // Extract Paddle Price ID from the first item in the transaction
        const paddlePriceId = eventData.data?.items?.[0]?.price?.id; // Confirm this path with actual webhook data

        console.log(`Processing transaction: ID=${transactionId}, OccurredAt=${occurredAt}, PaddleCustomerID=${paddleCustomerId}, PaddlePriceID=${paddlePriceId}`);

        if (!paddleCustomerId) {
            console.error(
                `ERROR: No Paddle Customer ID in webhook for TxID ${transactionId}. Cannot continue.`
            );
            return;
        }

        if (!paddlePriceId) {
            console.error(
                `ERROR: Paddle Price ID missing in webhook data for TxID ${transactionId}. Cannot map to Zoho Item.`
            );
            return;
        }

        // --- Step 1: Get customer details from Paddle ---
        const customerDetails = await getPaddleCustomerDetails(paddleCustomerId);

        // --- Step 2: Check if email received from Paddle ---
        if (!customerDetails || !customerDetails.email) {
            console.error(
                `ERROR: No email from Paddle API for Customer ID ${paddleCustomerId}, TxID ${transactionId}. Stopping.`
            );
            return;
        }

        // --- Step 3: Use Paddle details ---
        const customerEmail = customerDetails.email;
        const customerName = customerDetails.name || customerEmail; // Use email as fallback name

        console.log(
            `Got from Paddle API: Email=${customerEmail}, Name=${customerName}`
        );

        // --- Step 4: Get amount and currency from webhook ---
        let amount = 0;
        const paymentInfo = eventData.data?.payments?.[0]; // Assuming first payment object has the amount

        const amountFromPaddle = paymentInfo?.amount;
        const currency = eventData.data?.currency_code;

        if (amountFromPaddle) {
            const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
             // Paddle V2 amounts are in cents, need to convert to dollars for Zoho (if Zoho expects dollars)
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0;
                console.log(`Converted amount from Paddle (cents) to dollars: ${amount}`);
            } else {
                console.error(
                    `Bad amount format from webhook: "${amountFromPaddle}" for TxID ${transactionId}`
                );
                 return; // Stop if amount is invalid
            }
        } else {
            console.error(`ERROR: Amount missing in webhook for TxID ${transactionId}. Cannot create invoice.`);
            return; // Stop if amount is missing
        }

        if (!currency) {
             console.error(`ERROR: Currency missing for TxID ${transactionId}. Cannot create invoice.`);
             return; // Stop if currency is missing
        }

        console.log(`Amount: ${amount} ${currency}`);


        // --- Step 5: Get Zoho Item ID using the Paddle Price ID ---
        const zohoItemId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId];

        if (!zohoItemId || typeof zohoItemId !== 'string' || zohoItemId.length === 0 || zohoItemId.startsWith("6250588000000XXXXXX")) { // Check for placeholder too
             console.error(
                `ERROR: Could not find valid Zoho Item ID mapping for Paddle Price ID "${paddlePriceId}". Looked up value: "${zohoItemId}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP.`
             );
             return; // Stop if mapping is invalid
        }
        console.log(`Mapped Paddle Price ID "${paddlePriceId}" to Zoho Item ID "${zohoItemId}"`);


        // --- Step 6: Call Zoho functions ---
        console.log(
            `Initiating Zoho process: Customer=${customerEmail}, TxID=${transactionId}, ItemID=${zohoItemId}, Amount=${amount} ${currency}`
        );

        // Get or create Zoho customer ID
        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        // If we got Zoho customer ID...
        if (zohoCustomerId) {
            // Create Zoho invoice using the mapped Zoho Item ID
            const invoiceId = await createInvoiceInZoho(
                zohoCustomerId,
                paddlePriceId, // Pass Paddle Price ID to lookup Item ID inside
                amount,
                currency
            );

            // If invoice created...
            if (invoiceId) {
                console.log(
                    `Invoice ${invoiceId} created in Zoho Billing for TxID ${transactionId}.`
                );

                // Email the invoice
                console.log(
                    `Trying email invoice ${invoiceId} to ${customerEmail} for TxID ${transactionId}.`
                );
                await emailZohoInvoice(invoiceId, customerEmail);

            } else {
                // Invoice creation failed
                console.error(
                    `Zoho invoice creation failed for TxID ${transactionId}. Email not sent.`
                );
            }
        } else {
            // Failed to get/create Zoho customer
            console.error(
                `Zoho customer step failed for ${customerEmail}. Invoice not created for TxID ${transactionId}.`
            );
        }
    } catch (error) {
        console.error("Unhandle Error in handleTransactionCompleted:", error);
    } finally {
         console.log(`--- Finished processing transaction.completed webhook ---`);
    }
}

// --- Express Webhook Endpoint ---
app.post("/paddle-webhook", async (req, res) => {
    console.log(
        `--- PADDLE WEBHOOK ENDPOINT HIT at ${new Date().toISOString()} ---`
    );

    try {
        const eventData = req.body;

        // WARNING: In production, you MUST verify the webhook signature!
        // Paddle V2 signature verification steps: https://developer.paddle.com/webhooks/overview#verifying-webhooks
        // Skipping this is a major security risk.

        console.log(
            ">>> Paddle Webhook Received Data:",
            JSON.stringify(eventData, null, 2) // Log full payload for debugging
        );

        const eventType = eventData?.event_type;
        const transactionId = eventData.data?.id; // Get Tx ID early for logging

        console.log(`Received Paddle event type: ${eventType} (TxID: ${transactionId})`);

        if (eventType === "transaction.completed") {
            // Process asynchronously to avoid blocking the response
            handleTransactionCompleted(eventData).catch((err) => {
                console.error(`Error processing transaction completed handler for TxID ${transactionId}:`, err);
            });

            // Acknowledge receipt immediately. Processing happens in the background.
            res.status(200).send(`Webhook received and processing for ${eventType} initiated.`);

        } else {
            console.log(`Unhandled event type: ${eventType} (TxID: ${transactionId})`);
            res.status(200).send(`Webhook received, unhandled event type: ${eventType}`);
        }
    } catch (error) {
        console.error("Error receiving or processing webhook:", error);
        // Return a 500 if there's an error *receiving* or starting processing
        res.status(500).send("Internal Server Error during webhook reception");
    }
});

// --- Server Start ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    // Check for required environment variables on startup
    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
    if (!PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP || Object.keys(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).length === 0) {
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP is empty or missing. Invoice creation will fail.");
    } else if (Object.values(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).some(id => id.startsWith("6250588000000XXX"))) {
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP contains placeholder IDs. Replace them with actual Zoho Item IDs.");
    }
});
