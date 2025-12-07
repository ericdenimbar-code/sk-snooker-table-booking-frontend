'use server';

import { getRoomSettings, getHASettings } from './settings/actions';
import { DashboardForm } from './dashboard-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';

export default async function AdminDashboard() {

    if (!db) {
        return (
            <div className="flex flex-col gap-6">
                 <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
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

    const [room1Settings, room2Settings, haSettings] = await Promise.all([
        getRoomSettings('1'),
        getRoomSettings('2'),
        getHASettings(),
    ]);

    if (!room1Settings || !room2Settings || !haSettings) {
         return (
            <div className="flex flex-col gap-6">
                <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
                <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>資料讀取錯誤</AlertTitle>
                    <AlertDescription>
                        從 Firestore 讀取網站設定時發生錯誤。請檢查 Firestore 權限或前往「價目及內容設定」儲存一次設定以自動建立。
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center">
                <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
            </div>
             <p className="text-sm text-muted-foreground -mt-2">
                您可以在此進行快捷設定。更詳細的網站設定請前往「價目及內容設定」。
            </p>
            <DashboardForm 
              initialRoom1Settings={room1Settings}
              initialRoom2Settings={room2Settings}
              initialHaSettings={haSettings}
            />
        </div>
    );
}
