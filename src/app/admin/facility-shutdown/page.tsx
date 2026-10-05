import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import { FacilityShutdownClientPage } from './facility-shutdown-client-page';

export const dynamic = 'force-dynamic';

export default function FacilityShutdownPage() {
  if (!db) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold md:text-2xl">離場關機控制</h1>
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>後端連線錯誤</AlertTitle>
          <AlertDescription>無法連接至 Firebase，請檢查 Admin SDK 設定。</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">離場關機控制</h1>
        <p className="text-sm text-muted-foreground mt-1">
          設定離場關閉所有器材的生效時段與 4 位數字密碼。客人只在時段內可用該密碼，成功關閉後密碼即作廢。
        </p>
      </div>
      <FacilityShutdownClientPage />
    </div>
  );
}
