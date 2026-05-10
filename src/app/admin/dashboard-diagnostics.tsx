'use client';

import { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { app, db as clientDb } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

/** Must match server: @/app/admin/settings/actions `roomSettings` + doc id, no leading/trailing slashes or spaces. */
const ROOM_SETTINGS_COLLECTION = 'roomSettings';
const ROOM_DOC_1 = '1';

function stringifyUnknown(err: unknown): string {
  if (err instanceof Error) {
    return JSON.stringify(
      { name: err.name, message: err.message, stack: err.stack },
      null,
      2
    );
  }
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

type DashboardDiagnosticsProps = {
  adminProjectId: string | null;
};

export function DashboardDiagnostics({ adminProjectId }: DashboardDiagnosticsProps) {
  const [loading, setLoading] = useState(false);
  const [clientResult, setClientResult] = useState<string | null>(null);

  const clientProjectId = app.options.projectId ?? '';

  const runClientGetDoc = async () => {
    setLoading(true);
    setClientResult(null);
    try {
      const ref = doc(clientDb, ROOM_SETTINGS_COLLECTION, ROOM_DOC_1);
      const snap = await getDoc(ref);
      setClientResult(
        JSON.stringify(
          {
            refPath: ref.path,
            exists: snap.exists(),
            id: snap.id,
            data: snap.exists() ? snap.data() : null,
          },
          null,
          2
        )
      );
    } catch (err) {
      setClientResult(stringifyUnknown(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-md border border-dashed p-4 text-sm">
      <p className="font-medium">Firestore 診斷（Client）</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
        <li>
          Admin SDK projectId（伺服器）：{' '}
          <span className="font-mono text-foreground">{adminProjectId ?? '(無法取得)'}</span>
        </li>
        <li>
          Client SDK app.options.projectId：{' '}
          <span className="font-mono text-foreground">{clientProjectId || '(無)'}</span>
        </li>
        <li>
          getDoc 路徑：{' '}
          <span className="font-mono text-foreground">
            {ROOM_SETTINGS_COLLECTION}/{ROOM_DOC_1}
          </span>
        </li>
      </ul>
      <Button type="button" variant="secondary" className="mt-3" disabled={loading} onClick={runClientGetDoc}>
        {loading ? '讀取中…' : '手動 getDoc（Client）讀取 roomSettings/1'}
      </Button>
      {clientResult ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{clientResult}</pre>
      ) : null}
    </div>
  );
}
