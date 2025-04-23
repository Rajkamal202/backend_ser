const express = require("express");
const axios = require("axios");
const app = express();
require('dotenv').config();

app.use(express.json());


const ZOHO_BILLING_API_URL = process.env.ZOHO_BILLING_API_URL;
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN;
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID; // Ensure this is set

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



async function handleTransactionCompleted(eventData) {
  try {
    const transactionId = eventData.data.id;
    const amount = eventData.data.items[0].price.amount;
    const currency = eventData.data.currency_code;
    const customerEmail = eventData.data.payments?.[0]?.billing_details?.email || "raop4903@gmail.com";

    console.log(`Extracted Amount: ${amount}, Currency: ${currency}`); // <-- Add this log
    console.log(`Handling transaction completed for customer: ${customerEmail}, transaction ID: ${transactionId}`);
    const customerId = await getZohoCustomerId(customerEmail);
    

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


// Function to find an existing Zoho Contact by email or create a new one
async function getZohoCustomerId(email) {
  const ZOHO_CONTACTS_API_URL = "https://www.zohoapis.in/invoice/v3/contacts";
  const AUTH_HEADER = `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`;
  const ORG_HEADER = { "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID };

  try {
    // Search for the contact by email
    console.log(`Searching for Zoho contact with email: ${email}`);
    const searchResponse = await axios.get(ZOHO_CONTACTS_API_URL, {
      headers: {
        Authorization: AUTH_HEADER,
        ...ORG_HEADER
      },
      params: { email: email }
    });

    if (searchResponse.data && searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
      const customerId = searchResponse.data.contacts[0].contact_id;
      console.log(`Found existing Zoho contact. ID: ${customerId}`);
      return customerId;
    } else {
      // Contact not found, attempt to create
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
          console.error("Failed to create Zoho contact, unexpected response:", createResponse.data);
          return null;
        }
      } catch (createError) {
        
        if (createError.response && createError.response.status === 400 && createError.response.data && createError.response.data.code === 3062) {
          console.log("Contact creation failed because it already exists (Code 3062). Re-searching...");
          // Contact was likely created by a concurrent request. Search again to get the ID.
          try {
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
                console.error("Error during second search for existing Zoho contact - Status:", secondSearchError.response.status, "Data:", JSON.stringify(secondSearchError.response.data));
             } else {
                console.error("Error during second search for existing Zoho contact:", secondSearchError.message);
             }
             return null;
          }
        } else {
          // --- Handle other creation errors ---
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
    // Handle errors during the initial search
    if (searchError.response) {
       console.error("Error during initial search for Zoho contact - Status:", searchError.response.status, "Data:", JSON.stringify(searchError.response.data));
    } else {
       console.error("Error during initial search for Zoho contact:", searchError.message);
    }
    return null;
  }
}
async function createInvoiceInZoho(customerId, amount, currency) {
  try {
    // --- Construct the URL WITH the send parameter ---
    const url = `${process.env.ZOHO_BILLING_API_URL}?send=true`; // Append ?send=true

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
    console.log("Calling URL:", url); // Log the URL being called
    console.log("Using Access Token:", ZOHO_OAUTH_TOKEN ? ZOHO_OAUTH_TOKEN.substring(0, 15) + '...' : 'undefined');
    console.log("Using Org ID:", ZOHO_ORGANIZATION_ID);

    // --- Use the modified URL in the axios call ---
    const response = await axios.post(
      url, // Use the URL with ?send=true
      invoiceData,
      {
        headers: {
          Authorization: `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
          "Content-Type": "application/json",
          "X-com-zoho-invoice-organizationid": ZOHO_ORGANIZATION_ID,
        },
      }
    );

    // Check the response message - successful sending usually indicated here
    console.log("Invoice Creation Response:", response.data.message); // e.g., "Invoice created and sent successfully."
    console.log("Invoice created, Number:", response.data.invoice.invoice_number);

  } catch (error) {
    if (error.response) {
        console.error("Error creating/sending invoice in Zoho - Status:", error.response.status, "Data:", JSON.stringify(error.response.data));
    } else {
        console.error("Error creating/sending invoice in Zoho:", error.message);
    }
  }
}
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
