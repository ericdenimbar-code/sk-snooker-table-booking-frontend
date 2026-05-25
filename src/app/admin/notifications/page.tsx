import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import { getSiteNotificationsSerialized } from './actions';
import { NotificationsForm } from './notifications-form';

export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage() {
  if (!db) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-lg font-semibold md:text-2xl">通知管理</h1>
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>後端連線錯誤</AlertTitle>
          <AlertDescription>無法連接至 Firebase，請檢查 Admin SDK 設定。</AlertDescription>
        </Alert>
      </div>
    );
  }

  const initialData = await getSiteNotificationsSerialized();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">通知管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理全屏彈窗與頂部公告欄。請先「儲存暫存」各區塊，確認無誤後按「確定生效」寫入 Firestore。
          所有時間以香港時間 (HKT) 為準。
        </p>
      </div>
      <NotificationsForm initialData={initialData} />
    </div>
  );
}
