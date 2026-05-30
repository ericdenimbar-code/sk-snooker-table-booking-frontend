
'use server';

import { getRoomSettings } from '@/app/admin/settings/actions';
import { ReservationClientPage } from './reservation-client-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import Link from 'next/link';
import { formatInTimeZone } from 'date-fns-tz';
import { BLOCKED_SLOTS_COLLECTION, HKT } from '@/lib/blocked-slots';

export default async function NewReservationPage() {
    // This server component no longer fetches all reservations.
    // The responsibility is moved to the client for on-demand fetching.

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

    // 順序建立 / 讀取，避免並行首次開站時重複 bootstrap 與 revalidate 競態
    const room1Settings = await getRoomSettings('1');
    const room2Settings = await getRoomSettings('2');


    if (!room1Settings || !room2Settings) {
        return (
            <main className="flex flex-col items-center p-4 space-y-4">
                <Alert variant="destructive" className="w-full max-w-md">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>無法載入房間設定</AlertTitle>
                    <AlertDescription>
                        系統已嘗試自動建立預設房間設定但未成功。請確認 Firebase 後端（服務帳號）對「roomSettings」集合具備讀寫權限；若已修復，請重新整理頁面。亦可至後台「價目及內容設定」手動儲存一次以寫入資料。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    // We now pass an empty array for initialReservations. The client will handle fetching.
    const todayHkt = formatInTimeZone(new Date(), HKT, 'yyyy-MM-dd');
    const blockedDoc = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(todayHkt).get();
    const initialBlockedSlots: string[] = blockedDoc.exists()
        ? (Array.isArray(blockedDoc.data()?.slots) ? blockedDoc.data()!.slots as string[] : [])
        : [];

    return (
        <ReservationClientPage
            settings={room1Settings}
            room1Name={room1Settings.name}
            room2Name={room2Settings.name}
            initialReservations={[]}
            initialBlockedSlots={initialBlockedSlots}
            initialBlockedSlotsDate={todayHkt}
        />
    );
}
