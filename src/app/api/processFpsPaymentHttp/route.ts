
import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin'; // CORRECT IMPORT
import * as admin from 'firebase-admin';

interface FpsPaymentPayload {
  amount: number;
  payer: string;
  secret: string;
}

const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

export async function POST(request: Request) {
  // Wrap the entire function in a robust try-catch block to guarantee a response.
  try {
    console.log('[API] processFpsPaymentHttp function started.');

    // 1. Authenticate the request from Apps Script
    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;
    
    console.log(`[API] Received request: Amount=${amount}, Payer=${payer}`);

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      console.error('[API] Unauthorized: Missing or incorrect secret key.');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }
    console.log('[API] Secret key authorized.');
    
    // 2. Safely initialize Firebase Admin SDK
    const { db, error: dbError } = getFirebaseAdmin(); // CORRECT FUNCTION CALL
    if (!db || dbError) {
      console.error('[API] DB connection failed:', dbError?.message);
      return NextResponse.json(
        { status: 'error', message: `Database connection failed: ${dbError?.message}` },
        { status: 500 }
      );
    }
    console.log('[API] Database connection successful.');

    // 3. Validate the payload
    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`[API] Invalid amount received: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }
    console.log(`[API] Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);

    // 4. Query for matching token requests (Simplified Query)
    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.log(`[API] No documents found with 'requesting' status. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests found.' }, { status: 200 });
    }
    console.log(`[API] Found ${requestSnapshot.docs.length} documents with 'requesting' status. Filtering by amount in backend...`);

    // 5. Filter for the exact amount in the backend
    const matchingDocs = requestSnapshot.docs.filter(doc => doc.data().totalPriceHKD === amount);

    if (matchingDocs.length === 0) {
      console.log(`[API] No pending requests found for amount HKD ${amount}.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' }, { status: 200 });
    }
    
    if (matchingDocs.length > 1) {
      console.warn(`[API] Found ${matchingDocs.length} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
      return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' }, { status: 200 });
    }

    // 6. Process the unique match in a transaction
    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data();
    console.log(`[API] Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      console.error(`[API] CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
      return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    console.log(`[API] Found user "${userDoc.data().email}" (ID: ${userDoc.id}). Starting transaction...`);

    await db.runTransaction(async (transaction) => {
       const tokenQuantity = requestData.tokenQuantity;
       transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
       transaction.update(requestDoc.ref, { 
           status: 'completed', 
           completionDate: new Date().toISOString(),
           notes: `Automatically approved based on payment from: ${payer || 'Unknown'}`
        });
    });
    
    console.log(`[API] SUCCESS: Transaction for request ${requestDoc.id} completed.`);
    return NextResponse.json({ status: 'success', message: `Request ${requestDoc.id} processed.` });

  } catch (error: any) {
    // This is the crucial part for debugging.
    console.error('[API] FATAL: An unexpected error occurred in POST /api/processFpsPaymentHttp:', error.stack || error.message);
    return NextResponse.json(
      { status: 'error', message: `An internal server error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
