import type { RoomSettings } from './settings/actions';
import { DashboardForm } from './dashboard-form';
import { DashboardDiagnostics } from './dashboard-diagnostics';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db, getFirebaseAdminProjectId } from '@/lib/firebase-admin';

const ROOM_SETTINGS_COLLECTION = 'roomSettings';
const ROOM_DOC_ID_1 = '1';
const ROOM_DOC_ID_2 = '2';

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

export default async function AdminDashboard() {
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

  try {
    const room1Ref = db.collection(ROOM_SETTINGS_COLLECTION).doc(ROOM_DOC_ID_1);
    const room2Ref = db.collection(ROOM_SETTINGS_COLLECTION).doc(ROOM_DOC_ID_2);

    const [room1Snap, room2Snap] = await Promise.all([room1Ref.get(), room2Ref.get()]);

    if (!room1Snap.exists) {
      throw new Error(
        `Firestore 文件不存在：集合「${ROOM_SETTINGS_COLLECTION}」文件「${ROOM_DOC_ID_1}」（路徑 ${ROOM_SETTINGS_COLLECTION}/${ROOM_DOC_ID_1}，無多餘斜線或空格）`
      );
    }
    if (!room2Snap.exists) {
      throw new Error(
        `Firestore 文件不存在：集合「${ROOM_SETTINGS_COLLECTION}」文件「${ROOM_DOC_ID_2}」（路徑 ${ROOM_SETTINGS_COLLECTION}/${ROOM_DOC_ID_2}）`
      );
    }

    const room1Settings = room1Snap.data() as RoomSettings;
    const room2Settings = room2Snap.data() as RoomSettings;

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
      </div>
    );
  } catch (error) {
    const hiddenPayload = errorToJsonString(error);

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
              從 Firestore 讀取網站設定時發生錯誤。請檢查 Firestore 權限或前往「價目及內容設定」儲存一次設定以自動建立。
            </p>
            <p className="font-mono text-xs break-all">
              Admin projectId：{adminProjectId ?? '(無法取得)'} · getDoc 對應路徑：{ROOM_SETTINGS_COLLECTION}/{ROOM_DOC_ID_1}
              、{ROOM_SETTINGS_COLLECTION}/{ROOM_DOC_ID_2}
            </p>
          </AlertDescription>
        </Alert>
        <DashboardDiagnostics adminProjectId={adminProjectId} />
      </div>
    );
  }
}
