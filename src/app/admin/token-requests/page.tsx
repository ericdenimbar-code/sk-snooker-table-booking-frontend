'use server';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { getAllTokenPurchaseRequests } from './actions';
import { RequestsTable } from './requests-table';
import { db } from '@/lib/firebase-admin';

export default async function AdminTokenRequestsPage() {

    if (!db) {
        return (
            <div className="flex flex-col gap-4">
                <h1 className="text-lg font-semibold md:text-2xl">增值審批</h1>
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

    const result = await getAllTokenPurchaseRequests();

    if (!result.success || !result.requests) {
         return (
            <div className="flex flex-col gap-4">
                <h1 className="text-lg font-semibold md:text-2xl">增值審批</h1>
                <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>資料讀取錯誤</AlertTitle>
                    <AlertDescription>
                        從 Firestore 讀取增值請求時發生錯誤: {result.error}
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-lg font-semibold md:text-2xl">增值審批</h1>
             <Card>
                <CardHeader>
                    <CardTitle>所有增值請求</CardTitle>
                    <CardDescription>
                        查看並批核來自使用者的增值請求。
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <RequestsTable initialRequests={result.requests} />
                </CardContent>
            </Card>
        </div>
    );
}
