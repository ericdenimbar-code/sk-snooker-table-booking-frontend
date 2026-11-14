'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getHoldSwitchState, turnOffAllHolds, turnOffHoldTable } from './actions';

type TableKey = '1' | '2';

function readAdminId(): string {
  const raw = localStorage.getItem('user');
  if (!raw) return '';
  try {
    return (JSON.parse(raw) as { id?: string }).id ?? '';
  } catch {
    return '';
  }
}

function PowerSwitch({
  label,
  on,
  enabled,
  onTurnOff,
}: {
  label: string;
  on: boolean;
  enabled: boolean;
  onTurnOff: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-2xl font-black tracking-wide text-neutral-900">{label}</p>
      <button
        type="button"
        aria-label={`${label} ${on ? 'ON' : 'OFF'}`}
        aria-pressed={on}
        disabled={!enabled}
        onClick={onTurnOff}
        className={cn(
          'relative h-[4.75rem] w-56 rounded-full shadow-[0_6px_14px_rgba(0,0,0,0.18)] transition-colors',
          on ? 'bg-[#3dce6e]' : 'bg-[#c8c8c8]',
          enabled ? 'cursor-pointer' : 'cursor-not-allowed',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 -translate-y-1/2 text-[1.65rem] font-semibold tracking-wider',
            on ? 'left-8 text-white/85' : 'right-7 text-white/75',
          )}
        >
          {on ? 'ON' : 'OFF'}
        </span>
        <span
          className={cn(
            'absolute top-1.5 h-[3.9rem] w-[3.9rem] rounded-full bg-white shadow-[0_4px_10px_rgba(0,0,0,0.22)]',
            on ? 'right-1.5' : 'left-1.5',
          )}
        />
      </button>
    </div>
  );
}

export function FacilityShutdownClientPage() {
  const [table1, setTable1] = useState(false);
  const [table2, setTable2] = useState(false);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const refreshTicket = useRef(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (pendingRef.current) return;
    const ticket = refreshTicket.current;
    const adminUserId = readAdminId();
    const result = await getHoldSwitchState(adminUserId);
    if (pendingRef.current || ticket !== refreshTicket.current) return;
    if (!result.success && result.error && !result.table1 && !result.table2) {
      setTable1(false);
      setTable2(false);
      setError(result.error);
    } else {
      setTable1(result.table1);
      setTable2(result.table2);
      setError(result.error && !result.success ? result.error : '');
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const turnOffTable = async (table: TableKey) => {
    if (pending) return;
    const adminUserId = readAdminId();
    if (!adminUserId) {
      setError('找不到管理員身分，請重新登入。');
      return;
    }
    pendingRef.current = true;
    refreshTicket.current += 1;
    setPending(true);
    setError('');
    setStatusText('');
    if (table === '1') setTable1(false);
    else setTable2(false);
    try {
      const result = await turnOffHoldTable(adminUserId, table);
      if (!result.success) setError(result.error || '未能關閉。');
      else if (result.warning) setError(result.warning);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '未能關閉。');
    } finally {
      pendingRef.current = false;
      setPending(false);
      await refresh();
    }
  };

  const turnOffAll = async () => {
    if (pending) return;
    const adminUserId = readAdminId();
    if (!adminUserId) {
      setError('找不到管理員身分，請重新登入。');
      return;
    }
    pendingRef.current = true;
    refreshTicket.current += 1;
    setPending(true);
    setError('');
    setTable1(false);
    setTable2(false);
    setStatusText('枱號1正在關閉，30秒後關閉枱號2。');
    try {
      const result = await turnOffAllHolds(adminUserId);
      if (!result.success) setError(result.error || '未能全部關閉。');
      else if (result.warning) setError(result.warning);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '未能全部關閉。');
    } finally {
      setStatusText('');
      pendingRef.current = false;
      setPending(false);
      await refresh();
    }
  };

  const bothOn = table1 && table2;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-12 bg-white px-6 py-12">
      <PowerSwitch label="枱號 1" on={table1} enabled={ready && !pending && table1} onTurnOff={() => void turnOffTable('1')} />
      <PowerSwitch label="枱號 2" on={table2} enabled={ready && !pending && table2} onTurnOff={() => void turnOffTable('2')} />
      <PowerSwitch label="全關" on={bothOn} enabled={ready && !pending && bothOn} onTurnOff={() => void turnOffAll()} />
      {statusText && <p className="text-center text-sm text-muted-foreground">{statusText}</p>}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
