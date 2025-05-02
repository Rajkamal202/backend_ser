const express = require("express");
const axios = require("axios");
const app = express();
require("dotenv").config();

app.use(express.json());

// --- Configuration & Constants ---
// Use the base URL without the version path, version path added in functions
// Read and TRIM environment variables to remove potential whitespace
const ZOHO_API_BASE_URL = process.env.ZOHO_API_URL?.trim() || "https://www.zohoapis.com"; // Add trim here too if env var is used
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN?.trim(); // *** ADDED .trim() ***
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID?.trim(); // *** ADDED .trim() ***
const PADDLE_API_KEY = process.env.PADDLE_API_KEY?.trim(); // Added trim for Paddle key too


// --- Mappings ---
// Renamed for clarity: Paddle Price ID maps directly to Zoho Product ID for invoices (based on docs)
// You MUST replace the placeholder IDs with actual Zoho PRODUCT IDs from your USA Production org.
const PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP = { // Renamed for clarity, but maps Paddle Price ID to Zoho Product ID
    // Example: 'your_paddle_price_id_1': 'your_zoho_product_id_1',
    // Example: 'your_paddle_price_id_2': 'your_zoho_product_id_2',
   "pri_01js3tjscp3sqvw4h4ngqb5d6h": "6250588000000100001",
   "pri_01js3ty4vadz3hxn890a9yvax1": "6250588000000100001",
    "pri_01js3v0bh5yfs8k7gt4ya5nmwt": "6250588000000100001"
};


// --- Paddle API Function ---
async function getPaddleCustomerDetails(paddleCustomerId) {
    const PADDLE_API_BASE_URL = process.env.PADDLE_SANDBOX_API_URL?.trim() || "https://sandbox-api.paddle.com"; // Use sandbox for testing Paddle API

    if (!paddleCustomerId) {
        console.error("getPaddleCustomerDetails: Need Paddle Customer ID.");
        return null;
    }

    if (!PADDLE_API_KEY) {
        console.error("getPaddleCustomerDetails: PADDLE_API_KEY missing.");
        return null;
    }

    const PADDLE_CUSTOMER_URL = `<span class="math-inline">\{PADDLE\_API\_BASE\_URL\}/customers/</span>{paddleCustomerId}`;

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

/**
 * Find Zoho customer using email. If not found, create new one.
 * Uses Zoho Billing API. Returns Zoho customer ID.
 */
async function getZohoCustomerId(email, name) {
    // ZOHO_API_BASE_URL is trimmed at the top level
    const ZOHO_CUSTOMERS_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/customers`;

    // ZOHO_OAUTH_TOKEN and ZOHO_ORGANIZATION_ID are trimmed at the top level
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    if (!email) {
        console.error("getZohoCustomerId: Email needed.");
        return null;
    }

    const customerDisplayName = name || email;
    const searchParams = { search_text: email };

    // --- Function to handle customer creation (called if not found or specific search error occurs) ---
    const createCustomer = async () => {
         console.log(`Attempting to create customer: ${customerDisplayName}...`);
         const createPayload = { display_name: customerDisplayName, email: email };
         console.log("Creating Zoho customer payload:", JSON.stringify(createPayload));

          const createUrl = ZOHO_CUSTOMERS_API_URL; // Same URL as search

         // --- DEBUG LOGGING: See the exact POST request being sent ---
         console.log("--- Outgoing Zoho POST Customer Create Request ---");
         console.log(` URL: ${createUrl}`);
          // Log headers, obfuscating the full token for safety
          const logHeaders = {
               Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`,
               ...ORG_HEADER
          };
          console.log(` Headers: ${JSON.stringify(logHeaders)}`);
         console.log(` Body: ${JSON.stringify(createPayload)}`);
         console.log("-------------------------------------------------");
         // --- END DEBUG LOGGING ---


         try {
             const createResponse = await axios.post(
                 createUrl, 
                 createPayload,
                 {
                     headers: {
                         Authorization: AUTH_HEADER, // Use the full AUTH_HEADER string (constructed with trimmed token)
                         ...ORG_HEADER, // Use the ORG_HEADER object (constructed with trimmed org ID)
                         "Content-Type": "application/json",
                     },
                 }
             );

             if (createResponse.data?.customer?.customer_id) {
                 const newCustomerId = createResponse.data.customer.customer_id;
                 console.log(`Successfully created Zoho customer. ID: ${newCustomerId}`);
                 return newCustomerId;
             } else {
                 console.error(
                     "Failed to create Zoho customer, bad response data:",
                     JSON.stringify(createResponse.data)
                 );
                 return null; 
             }
         } catch (createError) {
             // --- Error Handling for Create Customer ---
             console.error(
                 "Error creating Zoho customer - Status:",
                 createError.response?.status,
                 "Data:",
                 JSON.stringify(createError.response?.data || createError.message)
             );
             return null;
         }
    };


    try {
        console.log(`Searching Zoho Billing customer by email: ${email}`);

        // --- DEBUG LOGGING: See the exact request being sent ---
        console.log("--- Outgoing Zoho GET Customer Search Request ---");
        const fullSearchUrlWithParams = `<span class="math-inline">\{ZOHO\_CUSTOMERS\_API\_URL\}?</span>{new URLSearchParams(searchParams).toString()}`;
        console.log(` Full URL w/ params: ${fullSearchUrlWithParams}`);

         // Log headers, obfuscating the full token for safety
         const logHeaders = {
              Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`,
              ...ORG_HEADER
         };
         console.log(` Headers: ${JSON.stringify(logHeaders)}`);
        console.log("------------------------------------------------");
        // --- END DEBUG LOGGING ---

        const searchResponse = await axios.get(ZOHO_CUSTOMERS_API_URL, {
            headers: { Authorization: AUTH_HEADER, ...ORG_HEADER }, // Headers constructed with trimmed variables
            params: searchParams,
        });

        // --- Handle successful search response (Status 200 OK) ---
        // If the API returns 200 and the 'customers' array is NOT empty, customer is found.
        if (searchResponse.data?.customers?.length > 0) {
            // Customer found
            const customerId = searchResponse.data.customers[0].customer_id;
            console.log(`Found Zoho customer. ID: ${customerId}`);
            return customerId;
        } else {
            // Customer not found (API returned 200 OK, but customer list is empty)
            console.log(`Search returned 200 OK but found no customers for email ${email}.`);
            return await createCustomer(); // Proceed to create customer
        }

    } catch (searchError) {
         // --- Handle Search Errors (including the 400) ---
         console.error("Error during Zoho customer search:");
         console.error(" Status:", searchError.response?.status);
         console.error(" Data:", JSON.stringify(searchError.response?.data || searchError.message));

         // Check if this is the *specific* 400 error observed in logs
         const isSpecific400Error = searchError.response?.status === 400 &&
                                    searchError.response?.data?.message === "The request passed is not valid.";

         if (isSpecific400Error) {
             // Received the specific 400 error. Treat this like a "not found" scenario
             console.warn(`Received specific 400 error on search. Treating as "customer not found" and attempting to create.`);
             return await createCustomer(); // Proceed to create customer
         } else {
             // Any other search error (authentication, server error, different validation error) is unexpected and fatal for the lookup -> Abort
             console.error(`Received unhandled error status ${searchError.response?.status} during search. Aborting customer lookup.`);
             return null; // Return null for other errors
         }
    }
}

/**
 * Create invoice in Zoho Billing.
 * Needs customer ID, paddlePriceId (for mapping to Product ID), amount, and currency.
 */
async function createInvoiceInZoho(customerId, paddlePriceId, amount, currency) {
    let createdInvoiceId = null;
    // ZOHO_API_BASE_URL is trimmed at the top level
    const ZOHO_INVOICES_API_URL = `${ZOHO_API_BASE_URL}/billing/v1/invoices`;

    // ZOHO_OAUTH_TOKEN and ZOHO_ORGANIZATION_ID are trimmed at the top level
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    // Use the globally defined mapping - Ensure these are ZOHO *PRODUCT* IDs now
    // based on the documentation field name "product_id"
    const zohoProductId = PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP[paddlePriceId]; // Assuming your map values are actually Product IDs

    // Validate the looked-up Product ID
    // Adjusted validation message as it's now zohoProductId
    if (!zohoProductId || typeof zohoProductId !== 'string' || zohoProductId.length === 0 || zohoProductId.startsWith("6250588000000XXX")) { // Check for placeholder too
        console.error(
           `Error creating invoice: Invalid, missing, or placeholder Zoho PRODUCT ID found for Paddle Price ID: "<span class="math-inline">\{paddlePriceId\}"\. Looked up value\: "</span>{zohoProductId}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP (should map to Zoho Product IDs).`
        );
        return null;
    }

    // --- Adjusted Invoice Payload Structure based on Zoho v1 Docs ---
    // Array name is 'invoice_items'
    // Linking field is 'product_id'
    // Unit price field is 'price'

    const invoiceData = {
        customer_id: customerId,
        invoice_items: [ // --- Renamed from 'line_items' to match documentation ---
            {
                product_id: zohoProductId, // --- Renamed from 'item_id' to match documentation ---
                quantity: 1,             // Assuming 1 unit is purchased per transaction
                price: amount          // --- Renamed from 'rate' to match documentation, use Paddle amount as unit price ---
                // Refer to Zoho Docs for other potentially useful fields like 'name', 'description', 'tax_id', etc.
                // Although product_id often pulls name/description, sometimes providing them makes invoices clearer.
            }
        ],
        // Add currency code at the top level as shown in docs
        currency_code: currency,
        // Add invoice date - crucial for accounting
        date: new Date().toISOString().split('T')[0], // Format:YYYY-MM-DD
        // Add reference number (optional but good practice, using Paddle Price ID or Tx ID)
        reference_number: paddlePriceId // Or Paddle transaction ID if available/suitable
        // Refer to docs for other top-level fields you might need (e.g., notes, terms)
        // notes: "Thank you for your purchase!",
        // terms: "Payment due upon receipt."
    };
    // --- END PAYLOAD MODIFICATION ---

    try {
        console.log(
            "Sending data to Zoho Billing Invoice (v1 structure):", // Updated log message
            JSON.stringify(invoiceData)
        );
        console.log("Calling URL:", ZOHO_INVOICES_API_URL);

        const headers = {
            Authorization: AUTH_HEADER, // Headers constructed with trimmed variables
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

    // ZOHO_API_BASE_URL is trimmed at the top level
    const ZOHO_EMAIL_API_URL = `<span class="math-inline">\{ZOHO\_API\_BASE\_URL\}/billing/v1/invoices/</span>{invoiceId}/email`;

    // ZOHO_OAUTH_TOKEN and ZOHO_ORGANIZATION_ID are trimmed at the top level
    const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
    const ORG_HEADER = {
        "X-com-zoho-subscriptions-organizationid": ZOHO_ORGANIZATION_ID,
    };

    // --- Verify Email Payload Structure with Zoho Docs ---\n\n\n\n```

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
                Authorization: AUTH_HEADER, // Headers constructed with trimmed variables
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
             // Paddle V2 amounts are in cents, need to convert to base unit (e.g., dollars) for Zoho
            if (!isNaN(amountInSmallestUnit)) {
                amount = amountInSmallestUnit / 100.0; // Assuming currency is a standard one like USD/INR where division by 100 is correct
                console.log(`Converted amount from Paddle (cents) to base unit: ${amount}`);
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

        // Use zohoItemId as zohoProductId in the invoice creation step payload as per documentation
        const zohoProductIdForInvoice = zohoItemId;


        if (!zohoProductIdForInvoice || typeof zohoProductIdForInvoice !== 'string' || zohoProductIdForInvoice.length === 0 || zohoProductIdForInvoice.startsWith("6250588000000XXX")) { // Check for placeholder too
             console.error(
                `ERROR: Could not find valid Zoho PRODUCT ID mapping for Paddle Price ID "${paddlePriceId}". Looked up value: "${zohoProductIdForInvoice}". Check PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP.`
             );
             return; // Stop if mapping is invalid
        }
        console.log(`Mapped Paddle Price ID "${paddlePriceId}" to Zoho PRODUCT ID "${zohoProductIdForInvoice}"`);


        // --- Step 6: Call Zoho functions ---
        console.log(
            `Initiating Zoho process: Customer=${customerEmail}, TxID=${transactionId}, ProductID=${zohoProductIdForInvoice}, Amount=${amount} ${currency}`
        );

        // Get or create Zoho customer ID
        const zohoCustomerId = await getZohoCustomerId(customerEmail, customerName);

        // If we got Zoho customer ID...
        if (zohoCustomerId) {
            // Create Zoho invoice using the mapped Zoho Product ID
            const invoiceId = await createInvoiceInZoho(
                zohoCustomerId,
                paddlePriceId, // Pass Paddle Price ID to lookup Product ID inside createInvoiceInZoho
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

    // --- DEBUG LOGGING: Show Environment Variables Loaded ---
    console.log(`--- Environment Variables Loaded ---`);
    console.log(` ZOHO_API_BASE_URL: ${ZOHO_API_BASE_URL}`);
    // CAUTION: Do not log the full token in production logs! Obfuscate or remove later.
    console.log(` ZOHO_OAUTH_TOKEN (first 10 chars): ${ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 10) + '...' : 'Not Set'}`);
    console.log(` ZOHO_ORGANIZATION_ID: ${ZOHO_ORGANIZATION_ID}`);
    console.log(` PADDLE_API_KEY (present): ${!!PADDLE_API_KEY}`); // Just check if present
    console.log(`------------------------------------`);
    // --- END DEBUG LOGGING ---


    // Check for required environment variables on startup (keep these checks)
    if (!ZOHO_OAUTH_TOKEN) console.warn("Warning: ZOHO_OAUTH_TOKEN missing.");
    if (!ZOHO_ORGANIZATION_ID) console.warn("Warning: ZOHO_ORGANIZATION_ID missing.");
    if (!PADDLE_API_KEY) console.warn("Warning: PADDLE_API_KEY missing.");
    if (!PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP || Object.keys(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).length === 0) {
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP is empty or missing. Invoice creation will fail.");
    } else if (Object.values(PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP).some(id => id.startsWith("6250588000000XXX") || id.startsWith("6250588000000YYYYYY") || id.startsWith("6250588000000ZZZZZZ"))) { // Adjusted placeholder check
         console.warn("Warning: PADDLE_PRICE_ID_TO_ZOHO_ITEM_ID_MAP contains placeholder IDs. Replace them with actual Zoho Product IDs.");
    }
});
