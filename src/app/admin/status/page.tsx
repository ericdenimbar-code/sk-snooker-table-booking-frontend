
'use server';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import { Button } from '@/components/ui/button';

// Helper function to create a preview of the environment variable
const getVarPreview = (variable: string | undefined): string => {
    if (!variable) {
        return "未載入";
    }
    if (variable.length < 20) {
        return "已載入 (值太短無法預覽)";
    }
    // Safely show the first 8 and last 8 characters
    return `已載入 (開頭: ${variable.substring(0, 8)}... , 結尾: ...${variable.substring(variable.length - 8)})`;
};


export default async function AdminStatusPage() {
    const isDbConnected = db !== null;
    let dbStatusMessage = '不明';
    let dbCanRead = false;

    if (isDbConnected) {
        try {
            await db.collection('_connection_test_').limit(1).get();
            dbCanRead = true;
            dbStatusMessage = '連線成功，並擁有讀取權限';
        } catch (error: any) {
            dbCanRead = false;
            dbStatusMessage = `連線成功，但讀取權限不足或發生錯誤：${error.message}`;
        }
    } else {
        dbStatusMessage = '連線失敗。請檢查您的 .env.local 檔案和伺服器日誌。';
    }

    const firebaseEnvVars = [
        { name: 'FIREBASE_PROJECT_ID', present: !!process.env.FIREBASE_PROJECT_ID, preview: getVarPreview(process.env.FIREBASE_PROJECT_ID) },
        { name: 'FIREBASE_CLIENT_EMAIL', present: !!process.env.FIREBASE_CLIENT_EMAIL, preview: getVarPreview(process.env.FIREBASE_CLIENT_EMAIL) },
        { name: 'FIREBASE_PRIVATE_KEY', present: !!process.env.FIREBASE_PRIVATE_KEY, preview: getVarPreview(process.env.FIREBASE_PRIVATE_KEY) },
    ];
    
    const googleEnvVars = [
        { name: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', present: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, preview: getVarPreview(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) },
        { name: 'GOOGLE_PRIVATE_KEY', present: !!process.env.GOOGLE_PRIVATE_KEY, preview: getVarPreview(process.env.GOOGLE_PRIVATE_KEY) },
        { name: 'GOOGLE_CALENDAR_ID_ROOM_1', present: !!process.env.GOOGLE_CALENDAR_ID_ROOM_1, preview: getVarPreview(process.env.GOOGLE_CALENDAR_ID_ROOM_1) },
        { name: 'GOOGLE_CALENDAR_ID_ROOM_2', present: !!process.env.GOOGLE_CALENDAR_ID_ROOM_2, preview: getVarPreview(process.env.GOOGLE_CALENDAR_ID_ROOM_2) },
    ];

    const allFirebaseVarsPresent = firebaseEnvVars.every(v => v.present);
    const allGoogleVarsPresent = googleEnvVars.every(v => v.present);
    const allVarsPresent = allFirebaseVarsPresent && allGoogleVarsPresent;

    const StatusIcon = ({isValid}: {isValid: boolean}) => 
        isValid ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-500" />;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const iamUrl = projectId 
        ? `https://console.cloud.google.com/iam-admin/iam?project=${projectId}`
        : 'https://console.cloud.google.com/iam-admin/iam';

    return (
        <div className="flex flex-col gap-6">
            <h1 className="text-lg font-semibold md:text-2xl">後端連線狀態與日誌</h1>
            <p className="text-sm text-muted-foreground -mt-4">
                此頁面幫助您診斷應用程式與後端服務的連線問題，並提供日誌訪問指引。
            </p>
            
            <Card>
                <CardHeader>
                    <CardTitle>網站日誌 (Logs)</CardTitle>
                </CardHeader>
                <CardContent>
                    <a href={iamUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" disabled={!projectId}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            前往 Google Cloud IAM 頁面
                        </Button>
                    </a>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Firebase 環境變數檢查</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        {firebaseEnvVars.map(v => (
                            <div key={v.name} className="flex items-center justify-between p-3 border rounded-lg">
                                <div>
                                    <code className="font-mono text-sm">{v.name}</code>
                                    <p className="text-xs text-muted-foreground">{v.preview}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant={v.present ? 'secondary' : 'destructive'}>{v.present ? '已載入' : '遺失'}</Badge>
                                    <StatusIcon isValid={v.present} />
                                </div>
                            </div>
                        ))}
                    </div>
                     <Alert variant={allFirebaseVarsPresent && dbCanRead ? "default" : "destructive"} className="mt-4">
                        {allFirebaseVarsPresent && dbCanRead ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        <AlertTitle>
                            {allFirebaseVarsPresent && dbCanRead ? 'Firebase 狀態正常' : 'Firebase 偵測到問題'}
                        </AlertTitle>
                        <AlertDescription>
                            {dbStatusMessage}
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Google Calendar 環境變數檢查</CardTitle>
                    <CardDescription>此處會顯示變數是否成功從您的 .env.local 檔案載入。</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2">
                        {googleEnvVars.map(v => (
                            <div key={v.name} className="flex items-center justify-between p-3 border rounded-lg">
                                <div>
                                    <code className="font-mono text-sm">{v.name}</code>
                                    <p className="text-xs text-muted-foreground">{v.preview}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant={v.present ? 'secondary' : 'destructive'}>{v.present ? '已載入' : '遺失'}</Badge>
                                    <StatusIcon isValid={v.present} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <Alert variant={allGoogleVarsPresent ? "default" : "destructive"} className="mt-4">
                        {allGoogleVarsPresent ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                        <AlertTitle>
                            {allGoogleVarsPresent ? 'Google Calendar 狀態正常' : 'Google Calendar 偵測到問題'}
                        </AlertTitle>
                        <AlertDescription>
                            {allGoogleVarsPresent ? '所有 Google Calendar 相關的環境變數都已載入。' : '一個或多個 Google Calendar 相關的環境變數遺失。'}
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
            
            <Alert variant={allVarsPresent && dbCanRead ? "default" : "destructive"}>
                {allVarsPresent && dbCanRead ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                <AlertTitle>
                    {allVarsPresent && dbCanRead ? '系統狀態正常' : '系統偵測到問題'}
                </AlertTitle>
                <AlertDescription>
                     {allVarsPresent && dbCanRead 
                        ? '後端服務已成功連接。需要從資料庫讀取資料的頁面應該可以正常運作。'
                        : '一個或多個後端設定不正確，這將會影響需要從資料庫讀取即時設定的頁面功能。請再次檢查您的 .env.local 檔案內容與格式是否正確，並確保您已重新啟動伺服器。'}
                </AlertDescription>
            </Alert>
        </div>
    );
}

    