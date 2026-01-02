
import { NextResponse } from 'next/server';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import type { TokenPurchaseRequest } from '@/types';
import * as logger from "firebase-functions/logger";

interface FpsPaymentPayload {
  amount: number;
  payer: string;
  secret: string;
}

const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

export async function POST(request: Request) {
  const { db, error: dbError } = getFirebaseAdmin();
  if (!db || dbError) {
    logger.error('API Error: Firebase Admin SDK initialization failed:', dbError?.message);
    return NextResponse.json(
      { status: 'error', message: 'Internal Server Error: Database not connected.' },
      { status: 500 }
    );
  }

  try {
    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      logger.error('API Error: Unauthorized request. Missing or incorrect secret key.');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      logger.error(`API Error: Invalid or missing amount received: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }
    
    logger.info(`API Info: Processing payment - Amount: HKD ${amount}, Payer: ${payer || 'N/A'}.`);
    
    const requestsQuery = db.collection('tokenRequests')
        .where('status', '==', 'requesting')
        .where('totalPriceHKD', '==', amount);
    
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      logger.warn(`API Warning: No pending requests found for HKD ${amount}. No action taken.`);
      return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' });
    } 
    
    if (requestSnapshot.size > 1) {
      logger.warn(`API Warning: Found ${requestSnapshot.size} ambiguous pending requests for HKD ${amount}. Manual approval is required.`);
      return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' });
    }

    const requestDoc = requestSnapshot.docs[0];
    const requestData = requestDoc.data() as TokenPurchaseRequest;
    logger.info(`API Info: Found unique match! Request ID: ${requestDoc.id} for user ${requestData.userEmail}.`);

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      logger.error(`API CRITICAL: Found request ${requestDoc.id} but cannot find user ${requestData.userEmail} in the 'users' collection!`);
      return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    logger.info(`API Info: Found user "${userDoc.data().name}" (ID: ${userDoc.id}). Starting transaction...`);

    await db.runTransaction(async (transaction) => {
       const tokenQuantity = requestData.tokenQuantity;
       transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
       transaction.update(requestDoc.ref, { 
           status: 'completed', 
           completionDate: new Date().toISOString(),
           notes: `Automatically approved based on payment from: ${payer || 'Unknown'}`
        });
    });
    
    logger.info(`API SUCCESS: Transaction for request ${requestDoc.id} completed.`);
    return NextResponse.json({ status: 'success', message: `Request ${requestDoc.id} processed.` });

  } catch (error: any) {
    logger.error('API FATAL: An unexpected error occurred in POST /api/processFpsPaymentHttp:', error);
    return NextResponse.json(
      { status: 'error', message: 'An internal server error occurred.' },
      { status: 500 }
    );
  }
}
