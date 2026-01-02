
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

// ============================================================================
// Firebase Admin SDK Initialization (In-File)
// ============================================================================

// Global cache for the initialized Firebase Admin SDK instance.
let adminInstance: { db: Firestore } | null = null;
let adminInitializationError: Error | null = null;

function getFirebaseAdmin() {
  // If already initialized (successfully or not), return the cached result.
  if (adminInstance || adminInitializationError) {
    return { db: adminInstance?.db, error: adminInitializationError };
  }

  // Check if the required environment variables are present.
  const hasAdminConfig = 
    process.env.SERVICE_ACCOUNT_PROJECT_ID &&
    process.env.SERVICE_ACCOUNT_CLIENT_EMAIL &&
    process.env.SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!hasAdminConfig) {
    adminInitializationError = new Error("Firebase Admin SDK not initialized: Missing one or more SERVICE_ACCOUNT environment variables.");
    console.error(`[API] DB INIT FAILED: ${adminInitializationError.message}`);
    return { db: null, error: adminInitializationError };
  }

  // Initialize only if we haven't already.
  if (!admin.apps.length) {
    try {
      console.log("[API] Attempting to initialize Firebase Admin SDK...");
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.SERVICE_ACCOUNT_PROJECT_ID,
          clientEmail: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
          privateKey: process.env.SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        }),
      });
      console.log("[API] ✅ Firebase Admin SDK successfully initialized.");
      adminInstance = {
        db: admin.firestore(),
      };
    } catch (error: any) {
      adminInitializationError = error;
      console.error("[API] ❌ Firebase Admin SDK initialization error:", error.message);
    }
  } else {
      adminInstance = {
        db: admin.firestore(),
      };
  }

  return { db: adminInstance?.db, error: adminInitializationError };
}

// ============================================================================
// API Route Logic
// ============================================================================

interface FpsPaymentPayload {
  amount: number;
  payer: string;
  secret: string;
}

type TokenPurchaseRequest = {
  id: string;
  userEmail: string;
  tokenQuantity: number;
  totalPriceHKD: number;
  status: 'requesting' | 'processing' | 'completed' | 'cancelled';
};

export async function POST(request: Request) {
  try {
    const { db, error: dbError } = getFirebaseAdmin();
    
    if (dbError || !db) {
        console.error('[API] FATAL: Could not get database instance.', dbError);
        return NextResponse.json({ status: 'error', message: `Database initialization failed: ${dbError?.message}` }, { status: 500 });
    }

    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;
    
    const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      console.error('[API] Unauthorized: Missing or incorrect secret key.');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`[API] Invalid amount received: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }

    console.log(`[API] Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);
    
    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.log(`[API] No documents found with 'requesting' status for any amount. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests found.' }, { status: 200 });
    }

    const matchingDocs = requestSnapshot.docs.filter(doc => doc.data().totalPriceHKD === amount);
    
    if (matchingDocs.length === 0) {
        console.log(`[API] No pending requests found for amount HKD ${amount}.`);
        return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' }, { status: 200 });
    }
    
    if (matchingDocs.length > 1) {
        console.warn(`[API] Found ${matchingDocs.length} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
        return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' }, { status: 200 });
    }

    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data() as TokenPurchaseRequest;
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
           notes: `Automatically approved by Apps Script based on payment from: ${payer || 'Unknown'}`
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
