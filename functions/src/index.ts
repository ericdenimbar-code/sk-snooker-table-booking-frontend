
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Define the shape of the TokenPurchaseRequest for type safety
interface TokenPurchaseRequest {
  id: string;
  userEmail: string;
  tokenQuantity: number;
  totalPriceHKD: number;
  status: 'requesting' | 'processing' | 'completed' | 'cancelled';
}


// ==========================================================================================
//  Initialization
// ==========================================================================================

// Initialize the Firebase Admin SDK only once.
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// Retrieve the secret key from the environment variables set by apphosting.yaml
const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

// ==========================================================================================
//  HTTP-triggered Cloud Function (Webhook for Google Apps Script)
// ==========================================================================================

export const processFpsPaymentHttp = onRequest(
  // Function options
  {
    // Allow unauthenticated calls from Google Apps Script.
    // We use our own secret key for security instead of IAM.
    invoker: 'public', 
    region: 'asia-east1',
    // Grant this function access to the secret key stored in Secret Manager.
    secrets: ["APPS_SCRIPT_SECRET_KEY"],
    // Handle CORS to allow requests from Google's script domains.
    cors: ["https://script.google.com", "https://script.googleusercontent.com"],
  }, 
  // Main function logic
  async (req, res) => {
    
    // --- Step 1: Immediately respond to the Apps Script request ---
    // This prevents the Apps Script from timing out while we do our work.
    res.status(200).send({ status: "Request received, processing in background." });

    logger.info(`[${new Date().toISOString()}] HTTP Trigger: Received a new payment notification.`);

    // --- Step 2: Basic validation ---
    if (req.method !== 'POST') {
        logger.warn(`Received a non-POST request (${req.method}). Ignoring.`);
        return;
    }

    try {
        const { amount, payer, secret } = req.body;
        
        // --- Step 3: Security Check - Verify the secret key ---
        if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
            logger.error("Unauthorized request: Missing or incorrect secret key. Aborting.");
            return; // Abort if the "secret handshake" fails.
        }

        if (typeof amount !== 'number' || amount <= 0) {
            logger.error(`Invalid or missing amount received: ${amount}. Aborting.`);
            return;
        }
        
        logger.info(`Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);
        
        // --- Step 4: Find the matching token request in Firestore ---
        logger.log(`Searching for a pending request with amount HKD ${amount}...`);
        
        const requestsQuery = db.collection('tokenRequests')
            .where('status', '==', 'requesting')
            .where('totalPriceHKD', '==', amount);
        
        const requestSnapshot = await requestsQuery.get();

        if (requestSnapshot.empty) {
            logger.warn(`No pending requests found for HKD ${amount}. The user may have cancelled it, or this is a duplicate payment. No action taken.`);
            return;
        } 
        
        if (requestSnapshot.size > 1) {
            logger.warn(`Found ${requestSnapshot.size} ambiguous pending requests for HKD ${amount}. Manual approval is required to avoid errors.`);
            // In this case, we don't automatically approve to avoid crediting the wrong user.
            // The admin can resolve this on the "增值審批" page.
            return;
        }

        // --- Step 5: Unique match found, proceed with processing ---
        const requestDoc = requestSnapshot.docs[0];
        const requestData = requestDoc.data() as TokenPurchaseRequest;
        logger.info(`Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

        const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
        const userSnapshot = await userQuery.get();

        if (userSnapshot.empty) {
            logger.error(`CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
            return;
        }
            
        const userDoc = userSnapshot.docs[0];
        logger.log(`Found user "${userDoc.data().name}" (ID: ${userDoc.id}). Starting transaction...`);

        // --- Step 6: Use a transaction to update user tokens and request status atomically ---
        // This ensures that both operations succeed or both fail, preventing inconsistent data.
        await db.runTransaction(async (transaction) => {
           const tokenQuantity = requestData.tokenQuantity;
           // Atomically increment the user's token balance.
           transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
           // Update the token request to mark it as completed.
           transaction.update(requestDoc.ref, { 
               status: 'completed', 
               completionDate: new Date().toISOString(),
               // Store the payer's name for reference.
               notes: `Automatically approved based on payment from: ${payer || 'Unknown'}`
            });
        });
        
        logger.info(`✅ SUCCESS: Transaction for request ${requestDoc.id} completed. User tokens have been updated.`);

    } catch (error: any) {
        logger.error('FATAL: An unexpected error occurred during the function execution:', error);
    }
});
