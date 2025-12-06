
'use server';

import { getRoomSettings } from '@/app/admin/settings/actions';
import { ReservationClientPage } from './reservation-client-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import Link from 'next/link';

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

    const [room1Settings, room2Settings] = await Promise.all([
        getRoomSettings('1'),
        getRoomSettings('2'),
    ]);


    if (!room1Settings || !room2Settings) {
        return (
            <main className="flex flex-col items-center p-4 space-y-4">
                <Alert variant="destructive" className="w-full max-w-md">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>無法載入房間設定</AlertTitle>
                    <AlertDescription>
                        無法從資料庫中找到房間設定。請嘗試在後台儲存一次設定以自動建立。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    // We now pass an empty array for initialReservations. The client will handle fetching.
    return (
        <ReservationClientPage
            settings={room1Settings}
            room1Name={room1Settings.name}
            room2Name={room2Settings.name}
            initialReservations={[]}
        />
    );
}
