
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { google } from "googleapis";

// ==========================================================================================
//  Initialization
// ==========================================================================================
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// ==========================================================================================
//  Types and Constants
// ==========================================================================================
interface TokenPurchaseRequest {
  id: string;
  userEmail: string;
  tokenQuantity: number;
  totalPriceHKD: number;
  status: 'requesting' | 'processing' | 'completed' | 'cancelled';
}

const TOKEN_REQUESTS_COLLECTION = 'tokenRequests';
const USERS_COLLECTION = 'users';

// ==========================================================================================
//  Helper Function: Process a single payment
// ==========================================================================================
async function processPayment(amount: number, payer: string): Promise<{ success: boolean; message: string }> {
  if (amount <= 0) {
    return { success: false, message: `Invalid amount: ${amount}` };
  }

  logger.info(`Processing payment - Amount: HKD ${amount}, Payer: ${payer}`);

  const requestsQuery = db.collection(TOKEN_REQUESTS_COLLECTION)
    .where('status', '==', 'requesting')
    .where('totalPriceHKD', '==', amount);

  const requestSnapshot = await requestsQuery.get();

  if (requestSnapshot.empty) {
    return { success: false, message: `No pending requests found for HKD ${amount}.` };
  }

  if (requestSnapshot.size > 1) {
    logger.warn(`Found ${requestSnapshot.size} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
    // To avoid crediting the wrong user, we will not proceed automatically.
    // An admin can resolve this on the "增值審批" page.
    // We can update all matched requests to 'processing' to signal this.
    const batch = db.batch();
    requestSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, { status: 'processing', notes: `自動核對發現多筆相同金額請求，需手動批核。付款人: ${payer}` });
    });
    await batch.commit();
    return { success: false, message: `Found ${requestSnapshot.size} ambiguous requests. Flagged for manual review.` };
  }

  // --- Unique match found, proceed with processing ---
  const requestDoc = requestSnapshot.docs[0];
  const requestData = requestDoc.data() as TokenPurchaseRequest;
  logger.info(`Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

  const userQuery = db.collection(USERS_COLLECTION).where('email', '==', requestData.userEmail).limit(1);
  const userSnapshot = await userQuery.get();

  if (userSnapshot.empty) {
    logger.error(`CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
    return { success: false, message: `User not found for email ${requestData.userEmail}.` };
  }
      
  const userDoc = userSnapshot.docs[0];
  logger.log(`Found user "${userDoc.data().name}" (ID: ${userDoc.id}). Starting transaction...`);

  await db.runTransaction(async (transaction) => {
     const tokenQuantity = requestData.tokenQuantity;
     transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
     transaction.update(requestDoc.ref, { 
         status: 'completed', 
         completionDate: new Date().toISOString(),
         notes: `由 Gmail 自動批核。付款人: ${payer}`
      });
  });
  
  return { success: true, message: `Transaction for request ${requestDoc.id} completed.` };
}


// ==========================================================================================
//  HTTP-triggered Cloud Function (for Apps Script Webhook) - Kept for compatibility
// ==========================================================================================
export const processFpsPaymentHttp = onRequest(
  {
    invoker: 'public', 
    region: 'asia-east1',
    secrets: ["APPS_SCRIPT_SECRET_KEY"],
    cors: ["https://script.google.com", "https://script.googleusercontent.com"],
  }, 
  async (req, res) => {
    // Immediately respond to the Apps Script request
    res.status(200).send({ status: "Request received, processing in background." });

    const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

    if (req.method !== 'POST') {
        logger.warn(`Received a non-POST request (${req.method}). Ignoring.`);
        return;
    }

    try {
        const { amount, payer, secret } = req.body;
        
        if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
            logger.error("Unauthorized request via HTTP: Missing or incorrect secret key. Aborting.");
            return;
        }

        const result = await processPayment(amount, payer);
        if (result.success) {
            logger.info(`✅ SUCCESS (HTTP): ${result.message}`);
        } else {
            logger.warn(`⚠️ WARNING (HTTP): ${result.message}`);
        }
    } catch (error: any) {
        logger.error('FATAL (HTTP): An unexpected error occurred:', error);
    }
});


// ==========================================================================================
//  Pub/Sub-triggered Cloud Function (for Gmail Push Notifications) - The new primary method
// ==========================================================================================
const GMAIL_USER = process.env.EMAIL_SERVER_USER;

if (!GMAIL_USER) {
    logger.error("CRITICAL: EMAIL_SERVER_USER environment variable is not set. Gmail Push Notifications will not work.");
}

const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
});

export const processFpsGmailNotification = onRequest(
  { region: 'asia-east1' },
  async (req, res) => {
    logger.info("Received a push notification from Gmail.");

    // Immediately acknowledge the request
    res.status(204).send();

    try {
        const message = req.body.message;
        if (!message || !message.data) {
            logger.warn("Received an invalid Pub/Sub message format.");
            return;
        }

        const data = JSON.parse(Buffer.from(message.data, 'base64').toString('utf-8'));
        const email = data.emailAddress;
        
        if (email !== GMAIL_USER) {
            logger.warn(`Received notification for a different email: ${email}. Ignoring.`);
            return;
        }

        const client = await auth.getClient();
        const gmail = google.gmail({ version: 'v1', auth: client as any });
        
        // Use historyId to get changes since the last known state
        const historyResponse = await gmail.users.history.list({
            userId: 'me',
            startHistoryId: data.historyId,
            historyTypes: ['messageAdded'],
        });

        const history = historyResponse.data.history;
        if (!history) {
            logger.info("No new message history found.");
            return;
        }

        for (const record of history) {
            if (!record.messagesAdded) continue;

            for (const msgAdded of record.messagesAdded) {
                if (!msgAdded.message || !msgAdded.message.id) continue;
                
                // Only process messages with the 'UNREAD' label
                if (msgAdded.message.labelIds?.includes('UNREAD')) {
                    const msgId = msgAdded.message.id;
                    const msgRes = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
                    
                    const fromHeader = msgRes.data.payload?.headers?.find(h => h.name === 'From')?.value || '';
                    const subjectHeader = msgRes.data.payload?.headers?.find(h => h.name === 'Subject')?.value || '';

                    // Check if the email is from the correct sender and has the correct subject pattern
                    if (fromHeader.includes('welab.bank') && subjectHeader.includes('你已收到')) {
                        const bodyData = msgRes.data.payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data;
                        if (bodyData) {
                            const emailBody = Buffer.from(bodyData, 'base64').toString('utf8');
                            
                            const amountMatch = emailBody.match(/金額為\s*HKD\s*([\d,]+\.?\d*)/);
                            const payerMatch = emailBody.match(/你已收到\s*(.+?)\s*的轉賬/);

                            if (amountMatch && amountMatch[1] && payerMatch && payerMatch[1]) {
                                const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
                                const payer = payerMatch[1].trim();
                                await processPayment(amount, payer);
                            }
                        }
                    }
                }
            }
        }

    } catch (error: any) {
        logger.error('FATAL (Pub/Sub): An unexpected error occurred:', error);
    }
});
