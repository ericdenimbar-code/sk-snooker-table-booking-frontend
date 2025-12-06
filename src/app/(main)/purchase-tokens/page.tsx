
'use server';

import { getRoomSettings, getPaymentInfo } from '@/app/admin/settings/actions';
import { PurchaseTokensClientPage } from './purchase-tokens-client-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import Link from 'next/link';

export default async function PurchaseTokensPage() {

    if (!db) {
         return (
            <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
                 <Alert variant="destructive" className="w-full max-w-2xl">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        無法連接至 Firebase 資料庫，因此無法載入頁面設定。請
                        <Link href="/admin/status" className="underline font-semibold">前往後台檢查連線狀態</Link>
                        以了解更多詳情。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    // Fetch both global settings and payment info in parallel
    const [settings, paymentInfo] = await Promise.all([
        getRoomSettings('1'), // Still need this for intro text etc.
        getPaymentInfo()
    ]);

    if (!settings) {
        return (
            <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
                <Alert variant="destructive" className="w-full max-w-2xl">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>無法載入頁面設定</AlertTitle>
                    <AlertDescription>
                        無法從資料庫中找到一般網站設定。請嘗試在後台儲存一次設定以自動建立。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }
    
    // paymentInfo will have default values even if it fails, so no need for a separate check.

    return (
       <PurchaseTokensClientPage settings={settings} paymentInfo={paymentInfo} />
    );
}
