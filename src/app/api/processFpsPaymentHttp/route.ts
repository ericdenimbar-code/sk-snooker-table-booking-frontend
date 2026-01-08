
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

// ============================================================================
//  Firebase Admin SDK Initialization (Self-Contained)
// ============================================================================
//  To eliminate any and all import/scoping issues, the entire initialization
//  logic is now self-contained within this API route file.

// Global cache for the initialized Firebase Admin SDK instance.
let adminInstance: { db: Firestore } | null = null;
let adminInitializationError: Error | null = null;

function getFirebaseAdmin() {
  if (adminInstance || adminInitializationError) {
    return { db: adminInstance?.db, error: adminInitializationError };
  }

  const hasAdminConfig = 
    process.env.SERVICE_ACCOUNT_PROJECT_ID &&
    process.env.SERVICE_ACCOUNT_CLIENT_EMAIL &&
    process.env.SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!hasAdminConfig) {
    adminInitializationError = new Error("關鍵環境變數遺失 (SERVICE_ACCOUNT...)");
    console.error(`[API] DB 初始化失敗: ${adminInitializationError.message}`);
    return { db: null, error: adminInitializationError };
  }

  // Initialize only if we haven't already.
  if (!admin.apps.length) {
    try {
      console.log("[API] 正在嘗試初始化 Firebase Admin SDK...");
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.SERVICE_ACCOUNT_PROJECT_ID,
          clientEmail: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
          privateKey: process.env.SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        }),
      });
      console.log("[API] ✅ Firebase Admin SDK 初始化成功。");
      adminInstance = {
        db: admin.firestore(),
      };
    } catch (error: any) {
      adminInitializationError = error;
      console.error("[API] ❌ Firebase Admin SDK 初始化時發生嚴重錯誤:", error.message);
    }
  } else {
      adminInstance = {
        db: admin.firestore(),
      };
  }

  return { db: adminInstance?.db, error: adminInitializationError };
}

// ============================================================================
//  Type Definitions (Self-Contained)
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

// ============================================================================
//  API POST Handler
// ============================================================================

export async function POST(request: Request) {
  // Master try-catch block to ensure any unexpected error is caught and logged.
  try {
    const { db, error: dbError } = getFirebaseAdmin();
    
    if (dbError || !db) {
        console.error('[API] 致命錯誤: 無法獲取資料庫實例。', dbError);
        return NextResponse.json({ status: 'error', message: `Database initialization failed: ${dbError?.message}` }, { status: 500 });
    }

    const body: FpsPaymentPayload = await request.json();
    const { amount, payer, secret } = body;
    
    const APPS_SCRIPT_SECRET_KEY = process.env.APPS_SCRIPT_SECRET_KEY;

    if (!APPS_SCRIPT_SECRET_KEY || secret !== APPS_SCRIPT_SECRET_KEY) {
      console.error('[API] 未授權的請求: 缺少或不正確的 secret key。');
      return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      console.error(`[API] 收到的金額無效: ${amount}.`);
      return NextResponse.json({ status: 'error', message: 'Invalid amount' }, { status: 400 });
    }

    console.log(`[API] 收到付款處理請求 - 金額: HKD ${amount}, 付款人: ${payer || 'N/A'}.`);
    
    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.log(`[API] 在資料庫中找不到任何狀態為 'requesting' 的增值請求。`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests found.' }, { status: 200 });
    }

    // Manually filter by amount in the backend code to avoid needing a composite index.
    const matchingDocs = requestSnapshot.docs.filter(doc => doc.data().totalPriceHKD === amount);
    
    if (matchingDocs.length === 0) {
        console.log(`[API] 找不到金額為 HKD ${amount} 的待處理請求。`);
        return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' }, { status: 200 });
    }
    
    if (matchingDocs.length > 1) {
        console.warn(`[API] 警告: 找到 ${matchingDocs.length} 個金額同樣為 HKD ${amount} 的待處理請求。需要手動批核以避免錯誤。`);
        return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' }, { status: 200 });
    }

    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data() as TokenPurchaseRequest;
    console.log(`[API] 找到唯一匹配! 請求 ID: ${requestDoc.id}，用戶: ${requestData.userEmail}.`);

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
        console.error(`[API] 嚴重錯誤: 找到請求 ${requestDoc.id} 但在 'users' 集合中找不到用戶 ${requestData.userEmail}！`);
        return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    console.log(`[API] 找到用戶 "${userDoc.data().email}" (ID: ${userDoc.id}). 準備開始資料庫交易...`);

    await db.runTransaction(async (transaction) => {
       const tokenQuantity = requestData.tokenQuantity;
       transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
       transaction.update(requestDoc.ref, { 
           status: 'completed', 
           completionDate: new Date().toISOString(),
           notes: `由 Apps Script 根據來自 ${payer || '未知'} 的付款自動批核。`
        });
    });
    
    console.log(`[API] 成功: 請求 ${requestDoc.id} 的交易已完成。`);
    return NextResponse.json({ status: 'success', message: `Request ${requestDoc.id} processed.` });

  } catch (error: any) {
    console.error('[API] POST /api/processFpsPaymentHttp 執行時發生未預期的致命錯誤:', error.stack || error.message);
    return NextResponse.json(
      { status: 'error', message: `An internal server error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
