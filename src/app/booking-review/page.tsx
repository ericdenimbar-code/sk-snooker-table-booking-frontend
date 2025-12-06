
'use server';

import { getRoomSettings } from '@/app/admin/settings/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal, Building2 } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import Link from 'next/link';
import { BookingReviewClientPage } from './booking-review-client-page';

export default async function BookingReviewPage() {
    // This server component fetches the necessary settings and branding info.
    // The client component will handle fetching the live reservation data.

    if (!db) {
         return (
            <main className="flex flex-col items-center p-4 space-y-4">
                <Alert variant="destructive" className="w-full max-w-md">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        無法連接至 Firebase 資料庫，因此無法載入房間設定。請
                        <Link href="/admin/status" className="underline font-semibold">前往後台檢查連線狀態</Link>
                        以了解更多詳情。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    // We only need settings from one room as most content is global.
    const settings = await getRoomSettings('1');

    if (!settings) {
        return (
            <main className="flex flex-col items-center p-4 space-y-4">
                <Alert variant="destructive" className="w-full max-w-md">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>無法載入頁面設定</AlertTitle>
                    <AlertDescription>
                        無法從資料庫中找到頁面設定。請嘗試在後台儲存一次設定以自動建立。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    return (
        <main className="flex flex-col items-center p-4 space-y-6 bg-background">
            {/* Group 1: Logo and Company Name */}
            <div className="text-center pt-6">
                {settings.siteBranding.logoUrl ? (
                    <img src={settings.siteBranding.logoUrl} alt="Logo" className="h-10 w-10 mx-auto object-contain" />
                ) : (
                    <Building2 className="h-10 w-10 mx-auto text-primary" />
                )}
                <h1 className="text-lg font-bold mt-2 text-primary">{settings.siteBranding.name}</h1>
            </div>

            {/* Group 2: Contact Information */}
            <div className="text-center max-w-md mx-auto">
                 <p className="text-muted-foreground">如有需要進行預約，請以WHATSAPP 54464661 通知我們，我們會儘快回覆作實。</p>
            </div>
            
            {/* Group 3: Read-only Calendar */}
            <BookingReviewClientPage
                settings={settings}
                initialReservations={[]} // Client will fetch live data
            />
        </main>
    );
}
