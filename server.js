const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config();

app.use(express.json());

const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL; 
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; 
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;

async function getZohoCustomerId(email) {
  const ZOHO_CONTACTS_API_URL = "https://www.zohoapis.in/invoice/v3/contacts"; 
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
  
    console.log(`Searching for Zoho contact with email: ${email}`);
    const searchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
      headers: {
        Authorization: AUTH_HEADER,
        ...ORG_HEADER 
      },
      params: {
        email: email
      }
    });
  
    if (searchResponse.data && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
      const customerId = searchResponse.data.contacts[0].contact_id;
      console.log(`Found existing Zoho contact. ID: ${customerId}`);
      return customerId;
    } else {
      console.log(`Contact not found for ${email}, attempting to create...`);
      const createPayload = {
        contact_name: email,
        email: email,
        
      };
      console.log("Creating Zoho contact with payload:", JSON.stringify(createPayload));

      try {
        // Try to create the contact 
        const createResponse = await axios.post(ZOHO_CONTACTS_API_URL, createPayload, {
          headers: {
            Authorization: AUTH_HEADER,
            ...ORG_HEADER,
            "Content-Type": "application/json",
          }
        });

        if (createResponse.data && createResponse.data.contact && createResponse.data.contact.contact_id) {
          const newCustomerId = createResponse.data.contact.contact_id;
          console.log(`Created new Zoho contact. ID: ${newCustomerId}`);
          return newCustomerId;
        } else {
          console.error("Failed to create Zoho contact, unexpected response:", JSON.stringify(createResponse.data)); // Log full response
          return null;
        }
      } catch (createError) {
        if (createError.response && createError.response.status === 400 && createError.response.data && createError.response.data.code === 3062) {

          console.log("Contact creation failed because it already exists (Code 3062). Waiting 2s before re-searching...");

          // Add Delay
          await new Promise(resolve => setTimeout(resolve, 2000)); 

          console.log("Re-searching after delay...");
          try {
            // Second search attempt
            const secondSearchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
              headers: { Authorization: AUTH_HEADER, ...ORG_HEADER },
              params: { email: email }
            });

            if (secondSearchResponse.data && secondSearchResponse.data.contacts && secondSearchResponse.data.contacts.length > 0) {
              const existingCustomerId = secondSearchResponse.data.contacts[0].contact_id;
              console.log(`Found existing Zoho contact on second search. ID: ${existingCustomerId}`);
              return existingCustomerId;
            } else {
              console.error("Contact reported as existing (3062), but not found on second search for email:", email);
              return null;
            }
          } catch (secondSearchError) {
             if (secondSearchError.response) {
                console.error("Error during second search - Status:", secondSearchError.response.status, "Data:", JSON.stringify(secondSearchError.response.data));
             } else {
                console.error("Error during second search:", secondSearchError.message);
             }
             return null;
          }
        } else {
          if (createError.response) {
            console.error("Error creating Zoho contact - Status:", createError.response.status, "Data:", JSON.stringify(createError.response.data));
          } else {
            console.error("Error creating Zoho contact:", createError.message);
          }
          return null;
        }
      }
    }
  } catch (searchError) {
    if (searchError.response) {
       console.error("Error during initial search - Status:", searchError.response.status, "Data:", JSON.stringify(searchError.response.data));
    } else {
       console.error("Error during initial search:", searchError.message);
    }
    return null;
  }
}
// Function to Record Payment against a Zoho Invoice
async function recordZohoPayment(customerId, invoiceId, paymentAmount, paymentDate, paddleTransactionId) {

  const ZOHO_PAYMENT_ACCOUNT_ID = process.env.ZOHO_PAYMENT_ACCOUNT_ID;
  

  if (!ZOHO_PAYMENT_ACCOUNT_ID) {
      console.error("Error: ZOHO_PAYMENT_ACCOUNT_ID is not set in environment variables.");
      return false; // Indicate failure
  }

  if (!invoiceId || !customerId || paymentAmount <= 0) {
     console.error("Cannot record payment: Missing invoiceId, customerId, or invalid amount.");
     return false;
  }

  const ZOHO_PAYMENTS_API_URL = "https://www.zohoapis.in/invoice/v3/customerpayments";
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    const paymentData = {
      customer_id: customerId,
      payment_mode: "Paddle", // Make sure 'Paddle' exists as a Payment Mode in Zoho Settings or use another appropriate one
      amount: paymentAmount,
      date: paymentDate, // Expecting YYYY-MM-DD format
      reference_number: paddleTransactionId, // Store Paddle Transaction ID here
      account_id: ZOHO_PAYMENT_ACCOUNT_ID,  // Where the money goes in Zoho's books
      invoices: [
        {
          invoice_id: invoiceId,
          amount_applied: paymentAmount // Apply the full amount to this invoice
        }
      ]
    };

    console.log(`Attempting to record payment for invoice ${invoiceId}. Payload:`, JSON.stringify(paymentData));

    const response = await axios.post(ZOHO_PAYMENTS_API_URL, paymentData, {
      headers: {
        Authorization: AUTH_HEADER,
        ...ORG_HEADER,
        "Content-Type": "application/json"
      }
    });

    // Check response message
    if (response.data && response.data.code === 0) { // Zoho typically uses code 0 for success
        console.log(`Successfully recorded payment for invoice ${invoiceId}. Payment ID: ${response.data.payment.payment_id}`);
        return true; // Indicate success
    } else {
        console.error(`Failed to record payment for invoice ${invoiceId}. Response:`, JSON.stringify(response.data));
        return false; // Indicate failure
    }

  } catch (error) {
    if (error.response) {
      console.error(`Error recording payment for invoice ${invoiceId} - Status:`, error.response.status, "Data:", JSON.stringify(error.response.data));
    } else {
      console.error(`Error recording payment for invoice ${invoiceId}:`, error.message);
    }
    return false; // Indicate failure
  }
}
async function emailZohoInvoice(invoiceId, recipientEmail) {
  if (!invoiceId || !recipientEmail) {
    console.error("Cannot email invoice: Missing invoiceId or recipientEmail.");
    return;
  }
  // Construct the specific email endpoint URL
  const ZOHO_EMAIL_API_URL = `https://www.zohoapis.in/invoice/v3/invoices/${invoiceId}/email`;
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    console.log(`Attempting to email invoice ${invoiceId} to ${recipientEmail}`);

    const emailPayload = {
       to_mail_ids: [recipientEmail], 
       subject: "Your Invoice from Autobot",
       body: "Thank you for your business! <br><br>Please find your invoice attached.<br><br>Regards,<br>Autobot Team" 
    };
    console.log("Sending Email Payload:", JSON.stringify(emailPayload));

    const response = await axios.post(ZOHO_EMAIL_API_URL, emailPayload, {
       headers: {
         Authorization: AUTH_HEADER,
         ...ORG_HEADER,
         "Content-Type": "application/json"
       }
    });
    // Check response message
    console.log(`Email Invoice Response for ${invoiceId}:`, response.data.message); // e.g., "Your invoice has been sent."

  } catch (error) {
     if (error.response) {
        console.error(`Error emailing invoice ${invoiceId} - Status:`, error.response.status, "Data:", JSON.stringify(error.response.data));
     } else {
        console.error(`Error emailing invoice ${invoiceId}:`, error.message);
     }
  }
}

//  Create Invoice in Zoho (Creates Draft, returns ID)
async function createInvoiceInZoho(customerId, amount, currency) {
  let createdInvoiceId = null; 
  try {
    const url = process.env.ZOHO_BILLING_API_URL; 

    const invoiceData = {
      customer_id: customerId, 
      line_items: [
        {
          name: "Subscription Payment", 
          rate: amount, 
          quantity: 1
        },
      ],
      currency_code: currency, 
    };
    console.log("Sending data to Zoho Invoice:", JSON.stringify(invoiceData));
    console.log("Calling URL:", url);
    console.log("Using Access Token:", ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 15) + '...' : 'undefined'); // Log part of token
    console.log("Using Org ID:", ZOHO_ORGANIZATION_ID);

    const response = await axios.post(url, invoiceData, {
      headers: {
        Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
        "Content-Type": "application/json",
        "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
      },
    });

    // Check response and store the ID
    if (response.data && response.data.invoice && response.data.invoice.invoice_id) {
       createdInvoiceId = response.data.invoice.invoice_id;
       console.log("Invoice Creation Response:", response.data.message); // e.g., "The invoice has been created."
       console.log("Invoice created, Number:", response.data.invoice.invoice_number, "ID:", createdInvoiceId);
    } else {
       console.error("Invoice created but ID not found in response", JSON.stringify(response.data)); // Log full response
    }

  } catch (error) {
    if (error.response) {
        console.error("Error creating invoice in Zoho - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
    } else {
        console.error("Error creating invoice in Zoho:", error.message);
    }
  }
  return createdInvoiceId; // Return the ID (or null if failed)
}

async function handleTransactionCompleted(eventData) {
  try {
    const transactionId = eventData.data.id;
    const occurredAt = eventData.data.occurred_at; // Get transaction time from Paddle if available
    
    // --- Extract Amount (Your existing logic) ---
    let amount = 0;
    if (eventData.data.payments && eventData.data.payments.length > 0) {
      const amountFromPaddle = eventData.data.payments[0].amount;
      if (amountFromPaddle) {
        const amountInSmallestUnit = parseInt(amountFromPaddle, 10);
        if (!isNaN(amountInSmallestUnit)) {
          amount = amountInSmallestUnit / 100.0;
        } else {
           console.error(`Could not parse amount string: "${amountFromPaddle}"`);
        }
      }
    } else {
      console.warn("Paddle event data did not contain payments array or it was empty.");
    }
    // --- End Amount Extraction ---

    const currency = eventData.data.currency_code; // Make sure you actually need/use this if passing to payment record
    const customerEmail = eventData.data.payments?.[0]?.billing_details?.email || "fallback@example.com"; // Use a real fallback or handle error

    console.log(`Handling transaction completed for customer: ${customerEmail}, transaction ID: ${transactionId}, Amount: ${amount}`);
    
    if (amount <= 0) {
        console.error("Amount is zero or invalid, cannot process invoice/payment.");
        return; // Stop processing if amount is invalid
    }

    const customerId = await getZohoCustomerId(customerEmail);

    if (customerId) {
      const invoiceId = await createInvoiceInZoho(customerId, amount, currency);

      if (invoiceId) {
        console.log(`Invoice ${invoiceId} created.`);

        // --- Add Payment Recording Step ---
        // Get payment date (use Paddle's transaction time if available, otherwise current time)
        const paymentDate = occurredAt 
            ? new Date(occurredAt).toISOString().split('T')[0] // Format as YYYY-MM-DD
            : new Date().toISOString().split('T')[0]; 

        console.log(`Attempting to record payment for invoice ${invoiceId} on date ${paymentDate}`);
        const paymentRecorded = await recordZohoPayment(customerId, invoiceId, amount, paymentDate, transactionId);
        
        if (paymentRecorded) {
            console.log(`Payment recorded successfully for invoice ${invoiceId}. Now attempting email.`);
             // Now email the invoice (which should hopefully reflect 'Paid' status, though Zoho might take a moment to update fully)
            await emailZohoInvoice(invoiceId, customerEmail);
        } else {
             console.error(`Failed to record payment for invoice ${invoiceId}. Email will still be attempted, but invoice may show as Overdue.`);
             // Decide if you still want to email if payment recording fails
             await emailZohoInvoice(invoiceId, customerEmail); 
        }
       

      } else {
        console.error("Invoice creation failed or did not return an ID. Payment/Email not processed.");
      }
    } else {
      console.error(`Could not find or create Zoho customer for email: ${customerEmail}. Invoice not created.`);
    }

  } catch (error) {
    console.error("Error handling transaction completed event:", error);
  }
}

app.post("/paddle-webhook", async (req, res) => {
  try {
    const eventData = req.body;
    const eventType = eventData.event_type;
    console.log(`Received Paddle event: ${eventType}`);
    if (eventType === "transaction.completed") {
      await handleTransactionCompleted(eventData);
    } else {
      console.log(`Unhandled event: ${eventType}`);
    }
    res.status(200).send("Webhook received successfully");
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).send("Internal Server Error during webhook processing");
  }
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
