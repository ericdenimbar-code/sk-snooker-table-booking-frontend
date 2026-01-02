
import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

// --- Backend-specific Type Definitions ---
// To avoid conflicts with client-side types, define the exact shapes needed for this backend operation.
type BackendTokenPurchaseRequest = {
  id: string;
  userEmail: string;
  tokenQuantity: number;
  totalPriceHKD: number;
  status: string;
};

type BackendUser = {
    id: string;
    email: string;
    tokens: number;
};

interface FpsPaymentPayload {
  amount: number;
  payer: string;
  secret: string;
}

const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

export async function POST(request: Request) {
  console.log('[API] processFpsPaymentHttp function started.');

  const { db, error: dbError } = getFirebaseAdmin();
  if (!db || dbError) {
    console.error('[API] DB connection failed:', dbError?.message);
    return NextResponse.json(
      { status: 'error', message: 'Internal Server Error: Database not connected.' },
      { status: 500 }
    );
  }
  console.log('[API] Database connection successful.');

  try {
    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;
    
    console.log(`[API] Received request: Amount=${amount}, Payer=${payer}`);

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      console.error('[API] Unauthorized: Missing or incorrect secret key.');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }
    console.log('[API] Secret key authorized.');

    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`[API] Invalid amount received: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }
    
    console.log(`[API] Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);
    
    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.log(`[API] No documents found with 'requesting' status. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests found.' });
    }
    console.log(`[API] Found ${requestSnapshot.docs.length} documents with 'requesting' status. Filtering by amount...`);

    const matchingDocs = requestSnapshot.docs.filter(doc => (doc.data() as BackendTokenPurchaseRequest).totalPriceHKD === amount);

    if (matchingDocs.length === 0) {
      console.log(`[API] No pending requests found for amount HKD ${amount}.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' });
    }
    
    if (matchingDocs.length > 1) {
      console.warn(`[API] Found ${matchingDocs.length} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
      return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' });
    }

    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data() as BackendTokenPurchaseRequest;
    console.log(`[API] Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      console.error(`[API] CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
      return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data() as BackendUser;
    console.log(`[API] Found user "${userData.email}" (ID: ${userDoc.id}). Starting transaction...`);

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
    console.error('[API] FATAL: An unexpected error occurred in POST /api/processFpsPaymentHttp:', error.stack || error.message);
    return NextResponse.json(
      { status: 'error', message: `An internal server error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
