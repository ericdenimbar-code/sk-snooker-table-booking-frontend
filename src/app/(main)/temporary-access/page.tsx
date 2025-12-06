
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
                        作為我們的貴賓，為方便大家處理儲物櫃存取球杆等事宜，閣下於下表中自行申請入場碼，每人每次可申請半小時入場時間，先選擇日期時段再按確定，系統便會自動發给你入場二維碼。
                    </p>
                </div>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>選擇進出時段</CardTitle>
                    <CardDescription>
                        選擇日期和時間以生成一個30分鐘有效期的臨時 QR Code。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <TemporaryAccessClientPage />
                </CardContent>
            </Card>
        </div>
    );
}
