
import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { TokenPurchaseRequest } from '@/types';

interface FpsPaymentPayload {
  amount: number;
  payer: string;
  secret: string;
}

const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

export async function POST(request: Request) {
  const { db, error: dbError } = getFirebaseAdmin();
  if (!db || dbError) {
    console.error('API Error: Firebase Admin SDK initialization failed:', dbError?.message);
    return NextResponse.json(
      { status: 'error', message: 'Internal Server Error: Database not connected.' },
      { status: 500 }
    );
  }

  try {
    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;
    
    console.info(`[API] Received request: Amount=${amount}, Payer=${payer}`);

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      console.error('[API] Unauthorized request: Missing or incorrect secret key.');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`[API] Invalid amount received: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }
    
    console.info(`[API] Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);
    
    // --- START: MODIFICATION TO AVOID COMPOSITE INDEX ---
    // 1. Fetch all documents with 'requesting' status. This is a simple query.
    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.warn(`[API] No pending requests found at all. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests for this amount.' });
    }

    // 2. Filter the results in the backend code by the amount.
    const matchingDocs = requestSnapshot.docs.filter(doc => (doc.data() as TokenPurchaseRequest).totalPriceHKD === amount);
    // --- END: MODIFICATION TO AVOID COMPOSITE INDEX ---


    if (matchingDocs.length === 0) {
      console.warn(`[API] No pending requests found for HKD ${amount}. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' });
    }
    
    if (matchingDocs.length > 1) {
      console.warn(`[API] Found ${matchingDocs.length} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
      return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' });
    }

    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data() as TokenPurchaseRequest;
    console.info(`[API] Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      console.error(`[API] CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
      return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    console.info(`[API] Found user "${userDoc.data().name}" (ID: ${userDoc.id}). Starting transaction...`);

    await db.runTransaction(async (transaction) => {
       const tokenQuantity = requestData.tokenQuantity;
       transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
       transaction.update(requestDoc.ref, { 
           status: 'completed', 
           completionDate: new Date().toISOString(),
           notes: `Automatically approved based on payment from: ${payer || 'Unknown'}`
        });
    });
    
    console.info(`[API] SUCCESS: Transaction for request ${requestDoc.id} completed.`);
    return NextResponse.json({ status: 'success', message: `Request ${requestDoc.id} processed.` });

  } catch (error: any) {
    console.error('[API] FATAL: An unexpected error occurred in POST /api/processFpsPaymentHttp:', error);
    return NextResponse.json(
      { status: 'error', message: `An internal server error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
