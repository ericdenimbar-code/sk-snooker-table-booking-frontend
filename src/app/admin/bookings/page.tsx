import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/firebase-admin";
import { getAdminBookingsInitialData } from "@/app/admin/bookings/actions";
import { BLOCKED_SLOTS_COLLECTION, emptyHolds, HKT, parseHoldsFromDoc, type HoldsByTable } from "@/lib/blocked-slots";
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
                        無法連接至 Firebase 資料庫，因此無法載入預訂資料。
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

  const initialResult = await getAdminBookingsInitialData();
  const todayHkt = formatInTimeZone(new Date(), HKT, 'yyyy-MM-dd');
  let initialHolds: HoldsByTable = emptyHolds();
  try {
    const holdDoc = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(todayHkt).get();
    initialHolds = holdDoc.exists
      ? parseHoldsFromDoc(holdDoc.data() as Record<string, unknown> | undefined)
      : emptyHolds();
  } catch (err) {
    console.error('[admin/bookings] Failed to load blockedSlots:', err);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
        <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold md:text-2xl">預訂管理日曆</h1>
        </div>
        {!initialResult.success && (
            <Alert variant="destructive">
                <Terminal className="h-4 w-4" />
                <AlertTitle>無法預載資料</AlertTitle>
                <AlertDescription>
                    伺服器讀取失敗：{initialResult.error}。日曆將嘗試以即時監聽同步。
                </AlertDescription>
            </Alert>
        )}
        <Card className="flex-1">
            <CardContent className="h-full p-2 sm:p-4 md:p-6">
                <BookingsCalendar
                  initialReservations={initialResult.reservations ?? []}
                  initialTempAccess={initialResult.accessCodes ?? []}
                  initialHolds={initialHolds}
                  initialHoldsDate={todayHkt}
                />
            </CardContent>
        </Card>
    </div>
  );
}
