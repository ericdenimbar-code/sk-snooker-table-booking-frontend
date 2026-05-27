
'use server';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TemporaryAccessClientPage } from "./temporary-access-client-page";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';

export default async function TemporaryAccessPage() {
    if (!db) {
         return (
            <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-8">
                <h1 className="text-lg font-semibold md:text-2xl">臨時進出碼</h1>
                 <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        無法連接至 Firebase。請前往「連線狀態」頁面以查看詳細的連線狀態檢查。
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold md:text-2xl">臨時進出碼</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        作為我們的貴賓，為方便大家處理儲物櫃存取球杆等事宜，閣下於下表中自行申請入場碼，每人每次可申請半小時入場時間，按確定後，系統便會自動發给你入場二維碼。
                    </p>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>選擇進出時段</CardTitle>
                    <CardDescription>
<<<<<<< Updated upstream
                      每次有效 30 分鐘，取消後方可再申請。
=======
                        以香港時間劃分 A 段（03:00–14:59）與 B 段（15:00–翌日 02:59）；同一時段內共用同一 QR 密鑰。VVIP 每次有效 30 分鐘，取消後方可再申請；管理員可無限次申請並以電郵轉發訪客。
>>>>>>> Stashed changes
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <TemporaryAccessClientPage />
                </CardContent>
            </Card>
        </div>
    );
}
