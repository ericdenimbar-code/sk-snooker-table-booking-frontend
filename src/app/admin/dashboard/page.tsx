import { getRoomSettings } from '../settings/actions';
import { DashboardForm } from '../dashboard-form';
import { TemporaryAccessRequestLog } from '../temporary-access-request-log';
import { DashboardDiagnostics } from '../dashboard-diagnostics';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db, getFirebaseAdminProjectId } from '@/lib/firebase-admin';

function errorToJsonString(error: unknown): string {
  if (error instanceof Error) {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  }
  try {
    return JSON.stringify(error);
  } catch {
    return JSON.stringify({ message: String(error) });
  }
}

export default async function AdminDashboardPage() {
  const adminProjectId = getFirebaseAdminProjectId();

  if (!db) {
    return (
      <div className="flex flex-col gap-6">
        <div className="hidden" aria-hidden="true" data-admin-dashboard-error>
          {JSON.stringify({ message: 'db is null', adminProjectId })}
        </div>
        <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>後端連線錯誤</AlertTitle>
          <AlertDescription>
            無法連接至 Firebase。請前往「連線狀態」頁面以查看詳細的連線狀態檢查。
          </AlertDescription>
        </Alert>
        <DashboardDiagnostics adminProjectId={adminProjectId} />
      </div>
    );
  }

  const [room1Settings, room2Settings] = await Promise.all([
    getRoomSettings('1'),
    getRoomSettings('2'),
  ]);

  if (!room1Settings || !room2Settings) {
    const hiddenPayload = errorToJsonString({
      message: 'getRoomSettings returned null',
      adminProjectId,
      paths: ['roomSettings/1', 'roomSettings/2'],
    });

    return (
      <div className="flex flex-col gap-6">
        <div className="hidden" aria-hidden="true" data-admin-dashboard-error>
          {hiddenPayload}
        </div>
        <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>資料讀取錯誤</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              無法從 Firestore 讀取或建立網站設定。請檢查 Firestore 權限與 Admin SDK 設定。
            </p>
            <p className="font-mono text-xs break-all">
              Admin projectId：{adminProjectId ?? '(無法取得)'} · 路徑：roomSettings/1、roomSettings/2
            </p>
          </AlertDescription>
        </Alert>
        <DashboardDiagnostics adminProjectId={adminProjectId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold md:text-2xl">管理員儀表板</h1>
        <p className="text-xs text-muted-foreground font-mono">
          Admin projectId：{adminProjectId ?? '(無法取得)'}
        </p>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        您可以在此進行快捷設定。更詳細的網站設定請前往「價目及內容設定」。
      </p>
      <DashboardForm initialRoom1Settings={room1Settings} initialRoom2Settings={room2Settings} />
      <TemporaryAccessRequestLog />
    </div>
  );
}
