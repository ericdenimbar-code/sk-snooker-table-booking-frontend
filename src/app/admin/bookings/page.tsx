'use server';

import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { db } from "@/lib/firebase-admin";
import { getAllReservations, getAllTemporaryAccess } from "@/app/(main)/new-reservation/actions";
import { BookingsCalendar } from "./bookings-calendar";

export default async function BookingsPage() {

    if (!db) {
        return (
             <div className="flex flex-col gap-4 h-full">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold md:text-2xl">預訂管理日曆</h1>
                </div>
                <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        無法連接至 Firebase 資料庫，因此無法載入預訂資料。請前往「連線狀態」頁面檢查您的設定。
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

  const [resResult, tempAccessResult] = await Promise.all([
    getAllReservations(),
    getAllTemporaryAccess()
  ]);

  if (!resResult.success || !resResult.reservations) {
    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold md:text-2xl">預訂管理日曆</h1>
            </div>
            <Alert variant="destructive">
                <Terminal className="h-4 w-4" />
                <AlertTitle>無法載入預訂資料</AlertTitle>
                <AlertDescription>
                    從資料庫讀取預訂資料時發生錯誤：{resResult.error || '未知錯誤'}
                </AlertDescription>
            </Alert>
        </div>
    );
  }
  
  // It's okay if temp access fails, we can still show bookings
  if (!tempAccessResult.success) {
     console.warn("Could not load temporary access codes:", tempAccessResult.error);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
        <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold md:text-2xl">預訂管理日曆</h1>
        </div>
        <Card className="flex-1">
            <CardContent className="h-full p-2 sm:p-4 md:p-6">
                <BookingsCalendar
                  initialReservations={resResult.reservations}
                  initialTempAccess={tempAccessResult.accessCodes || []}
                />
            </CardContent>
        </Card>
    </div>
  );
}
