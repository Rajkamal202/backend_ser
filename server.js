const axios = require("axios");
require('dotenv').config(); 


const ZOHO_API_BASE_URL = "https://www.zohoapis.com";
const ZOHO_BILLING_API_VERSION_PATH = "/billing/v1";
const ZOHO_OAUTH_TOKEN = process.env.ZOHO_OAUTH_TOKEN; 
const ZOHO_ORGANIZATION_ID = process.env.ZOHO_ORGANIZATION_ID;

const testCustomer = {
    display_name: `Test Customer ${Date.now()}`, 
    email: `test-${Date.now()}@example.com` 
};

async function attemptCreateCustomer() {
    if (!ZOHO_OAUTH_TOKEN || !ZOHO_ORGANIZATION_ID) {
        console.error("❌ ERROR: ZOHO_OAUTH_TOKEN or ZOHO_ORGANIZATION_ID not found in .env file.");
        console.error("   Please ensure your .env file has the correct Sandbox credentials.");
        return;
    }
    const url = `${ZOHO_API_BASE_URL}${ZOHO_BILLING_API_VERSION_PATH}/customers`;
    console.log(`Attempting to POST to: ${url}`);
    console.log(`Using Org ID: ${ZOHO_ORGANIZATION_ID}`);
    console.log(`Sending Payload: ${JSON.stringify(testCustomer)}`);

    try {
        const response = await axios.post(url, testCustomer, {
            headers: {
                'X-com-zoho-subscriptions-organizationid': ZOHO_ORGANIZATION_ID,
                'Authorization': `Zoho-oauthtoken ${ZOHO_OAUTH_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("\n--- Request Sent Successfully (Status Code OK) ---");
        console.log("Status:", response.status);
        console.log("Response Data:");
        console.log(JSON.stringify(response.data, null, 2));
        console.log("\nExpected: A JSON response confirming customer creation.");
        console.log("If this worked, the Sandbox API is now functioning correctly for this endpoint.");

    } catch (error) {
        console.error("\n--- ERROR DURING API CALL ---");
        if (error.response) {
            console.error("Status Code:", error.response.status);
            console.error("Response Headers:", JSON.stringify(error.response.headers, null, 2));
            console.error("Response Data (Error Details):");
            console.error(error.response.data);
            console.error("\nExpected: A JSON response confirming success or a JSON error object.");
            console.error("Actual: Received status", error.response.status, "with the data shown above. If it's HTML saying 'Invalid URL', this demonstrates the Sandbox API issue.");

        } else if (error.request) {
            console.error("No response received from Zoho:", error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
    }
}

attemptCreateCustomer();

