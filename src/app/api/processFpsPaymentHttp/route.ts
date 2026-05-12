
import { NextResponse } from 'next/server';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { sendTopUpConfirmationEmail, sendProblemTransactionAlertEmails } from '@/lib/email';
import type { User as AppUser, TokenPurchaseRequest } from '@/types';
import { expireStaleRequestingOrders } from '@/lib/token-requests-firestore';
import { fetchAdminAlertEmails } from '@/lib/admin-config-firestore';


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

    const payerDisplay = payer?.trim() || '未知';
    console.log(`[API] 收到付款處理請求 - 金額: HKD ${amount}, 付款人: ${payerDisplay}.`);

    const expiredCount = await expireStaleRequestingOrders(db);
    if (expiredCount > 0) {
      console.log(`[API] 已自動取消 ${expiredCount} 筆逾時（>1 小時）的 requesting 訂單。`);
    }

    const requestsQuery = db.collection('tokenRequests').where('status', '==', 'requesting');
    const requestSnapshot = await requestsQuery.get();

    if (requestSnapshot.empty) {
      console.log(`[API] 在資料庫中找不到任何狀態為 'requesting' 的增值請求。`);
      return NextResponse.json({ status: 'no_match', message: 'No pending requests found.' }, { status: 200 });
    }

    const minAmount = amount - 10;
    const maxAmount = amount + 10;
    const matchingDocs = requestSnapshot.docs.filter((doc) => {
      const total = doc.data().totalPriceHKD;
      return typeof total === 'number' && total >= minAmount && total <= maxAmount;
    });

    const alertEmails = await fetchAdminAlertEmails(db);

    if (matchingDocs.length === 0) {
      console.log(`[API] 找不到 totalPriceHKD 在 [${minAmount}, ${maxAmount}] 範圍內的待處理請求。`);
      return NextResponse.json({ status: 'no_match', message: 'No pending request for this amount.' }, { status: 200 });
    }

    if (matchingDocs.length > 1) {
      console.warn(
        `[API] 警告: 找到 ${matchingDocs.length} 筆金額落在 HKD ${minAmount}–${maxAmount} 的待處理請求，需手動處理。`,
      );
      const listHtml = `<ul>${matchingDocs
        .map((d) => {
          const row = d.data() as TokenPurchaseRequest;
          return `<li>請求 ${d.id}：${row.userEmail}，要求金額 HKD ${row.totalPriceHKD}，代幣 ${row.tokenQuantity}</li>`;
        })
        .join('')}</ul><p>收到轉帳金額：HKD ${amount}</p>`;
      await sendProblemTransactionAlertEmails(alertEmails, payerDisplay, listHtml);
      return NextResponse.json({ status: 'ambiguous_match', message: 'Multiple requests match this amount.' }, { status: 200 });
    }

    const requestDoc = matchingDocs[0];
    const requestData = requestDoc.data() as TokenPurchaseRequest;
    console.log(`[API] 找到唯一匹配! 請求 ID: ${requestDoc.id}，用戶: ${requestData.userEmail}.`);

    const reqAmount = requestData.totalPriceHKD;
    const actualAmount = amount;
    const diff = actualAmount - reqAmount;
    const ratio = reqAmount > 0 ? actualAmount / reqAmount : 0;
    const tokensToCredit = Math.round(requestData.tokenQuantity * ratio);

    if (!Number.isFinite(tokensToCredit) || tokensToCredit <= 0) {
      const detail = `<p>無法依比例發放代幣（計算結果：${tokensToCredit}）。請求 ${requestDoc.id}，用戶 ${requestData.userEmail}，要求金額 HKD ${reqAmount}，收到 HKD ${actualAmount}。</p>`;
      console.error(`[API] ${detail}`);
      await sendProblemTransactionAlertEmails(alertEmails, payerDisplay, detail);
      return NextResponse.json(
        { status: 'error', message: 'Computed token credit is invalid; admins have been notified.' },
        { status: 500 },
      );
    }

    const notesLine = `要求金額: ${reqAmount}, 實際收到: ${actualAmount}, 差額: ${diff}。由 Apps Script 根據來自 ${payerDisplay} 的付款自動批核（按比例發放 ${tokensToCredit} 代幣）。`;
    const hasDiscrepancy = Math.abs(actualAmount - reqAmount) > 0.005;

    const userQuery = db.collection('users').where('email', '==', requestData.userEmail).limit(1);
    const userSnapshot = await userQuery.get();

    if (userSnapshot.empty) {
      console.error(`[API] 嚴重錯誤: 找到請求 ${requestDoc.id} 但在 'users' 集合中找不到用戶 ${requestData.userEmail}！`);
      const detail = `<p>請求 ${requestDoc.id} 已匹配付款 HKD ${actualAmount}，但 Firestore 找不到用戶 ${requestData.userEmail}。</p>`;
      await sendProblemTransactionAlertEmails(alertEmails, payerDisplay, detail);
      return NextResponse.json({ status: 'error', message: 'User profile not found in database.' }, { status: 500 });
    }
        
    const userDoc = userSnapshot.docs[0];
    const userData = { id: userDoc.id, ...userDoc.data() } as AppUser;
    console.log(`[API] 找到用戶 "${userData.email}" (ID: ${userDoc.id}). 準備開始資料庫交易...`);
    
    let finalUserTokens = 0;

    await db.runTransaction(async (transaction) => {
       const freshUserDoc = await transaction.get(userDoc.ref);
       const currentTokens = freshUserDoc.data()?.tokens ?? 0;
       finalUserTokens = currentTokens + tokensToCredit;

       transaction.update(userDoc.ref, { tokens: admin.firestore.FieldValue.increment(tokensToCredit) });
       transaction.update(requestDoc.ref, { 
           status: 'completed', 
           completionDate: new Date().toISOString(),
           notes: notesLine,
           hasDiscrepancy,
        });
    });
    
    console.log(`[API] 成功: 請求 ${requestDoc.id} 的交易已完成。`);

    // --- Post-transaction side effect: Send Email ---
    try {
        const settings = await getRoomSettings('1');
        if (settings) {
            await sendTopUpConfirmationEmail(userData, tokensToCredit, finalUserTokens, settings.contactInfo, {
              hasDiscrepancy,
            });
        } else {
            console.error(`[API][CRITICAL] Failed to send top-up email to ${userData.email}: Cannot load settings.`);
        }
    } catch (emailError: any) {
        console.error(`[API][CRITICAL] Transaction for ${requestDoc.id} succeeded, but email sending failed:`, emailError);
    }
    
    return NextResponse.json({ status: 'success', message: `Request ${requestDoc.id} processed.` });

  } catch (error: any) {
    console.error('[API] POST /api/processFpsPaymentHttp 執行時發生未預期的致命錯誤:', error.stack || error.message);
    return NextResponse.json(
      { status: 'error', message: `An internal server error occurred: ${error.message}` },
      { status: 500 }
    );
  }
}
