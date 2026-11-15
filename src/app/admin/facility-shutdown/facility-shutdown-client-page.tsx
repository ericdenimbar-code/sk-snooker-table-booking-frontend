'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getFacilityControlState, turnOffAllHolds, turnOffHoldTable, turnOnHoldTable, type TableControl } from './actions';

type TableKey = '1' | '2';

const DURATIONS = [
  { value: '0.5', label: '半小時' },
  ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}小時` })),
];

const emptyTable: TableControl = { on: false, start: null, end: null, password: '' };

function readAdminId(): string {
  const raw = localStorage.getItem('user');
  if (!raw) return '';
  try {
    return (JSON.parse(raw) as { id?: string }).id ?? '';
  } catch {
    return '';
  }
}

function spacedTime(time: string): string {
  const [hour, minute] = time.split(':');
  return `${hour} : ${minute}`;
}

function PowerSwitch({ on, enabled, label, onClick }: { on: boolean; enabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${label} ${on ? 'ON' : 'OFF'}`}
      aria-pressed={on}
      disabled={!enabled}
      onClick={onClick}
      className={cn(
        'relative h-11 w-24 shrink-0 rounded-full shadow-[0_3px_8px_rgba(0,0,0,0.18)]',
        on ? 'bg-[#3dce6e]' : 'bg-[#cfcfcf]',
        enabled ? 'cursor-pointer' : 'cursor-not-allowed',
      )}
    >
      <span className={cn('absolute top-1/2 -translate-y-1/2 text-sm font-semibold', on ? 'left-3 text-white/90' : 'right-2.5 text-white/80')}>
        {on ? 'ON' : 'OFF'}
      </span>
      <span className={cn('absolute top-1 h-9 w-9 rounded-full bg-white shadow', on ? 'right-1' : 'left-1')} />
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="複製密碼"
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

export function FacilityShutdownClientPage() {
  const [table1, setTable1] = useState<TableControl>(emptyTable);
  const [table2, setTable2] = useState<TableControl>(emptyTable);
  const [allOffPassword, setAllOffPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const refreshTicket = useRef(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [openTable, setOpenTable] = useState<TableKey | null>(null);
  const [hours, setHours] = useState('1');
  const [popupError, setPopupError] = useState('');

  const refresh = useCallback(async () => {
    if (pendingRef.current) return;
    const ticket = refreshTicket.current;
    const result = await getFacilityControlState(readAdminId());
    if (pendingRef.current || ticket !== refreshTicket.current) return;
    if (!result.success) {
      setError(result.error || '無法讀取預留狀態。');
    } else {
      setTable1(result.table1);
      setTable2(result.table2);
      setAllOffPassword(result.allOffPassword);
      setError(result.error || '');
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    pendingRef.current = true;
    refreshTicket.current += 1;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : '操作失敗。');
    } finally {
      pendingRef.current = false;
      setPending(false);
      setStatusText('');
      await refresh();
    }
  };

  const turnOff = (table: TableKey) => run(async () => {
    const result = await turnOffHoldTable(readAdminId(), table);
    if (!result.success) setError(result.error || '未能關閉。');
    else if (result.warning) setError(result.warning);
  });

  const confirmOn = () => run(async () => {
    if (!openTable) return;
    const result = await turnOnHoldTable(readAdminId(), openTable, Number(hours));
    if (!result.success) {
      setPopupError(result.error || '未能開啟。');
      pendingRef.current = false;
      return;
    }
    if (result.warning) setError(result.warning);
    setOpenTable(null);
    setPopupError('');
  });

  const turnOffAll = () => run(async () => {
    setTable1((current) => ({ ...current, on: false }));
    setTable2((current) => ({ ...current, on: false }));
    setStatusText('枱號1正在關閉，30秒後關閉枱號2。');
    const result = await turnOffAllHolds(readAdminId());
    if (!result.success) setError(result.error || '未能全部關閉。');
    else if (result.warning) setError(result.warning);
  });

  const bothOn = table1.on && table2.on;

  const row = (label: string, table: TableKey, control: TableControl) => (
    <div className="flex items-center justify-between gap-4 border-b py-5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xl font-black tracking-wide">{label}</p>
        <p className="mt-1 text-sm text-neutral-700">
          {control.on && control.start && control.end ? `${spacedTime(control.start)} - ${spacedTime(control.end)}` : '預留時段尚未生效'}
        </p>
        {control.password && (
          <p className="mt-1 flex items-center gap-1 text-sm text-neutral-800">
            {control.on ? '關閉密碼' : '開啟密碼'}：{control.password}
            <CopyButton value={control.password} />
          </p>
        )}
      </div>
      <PowerSwitch
        label={label}
        on={control.on}
        enabled={ready && !pending}
        onClick={() => {
          if (control.on) void turnOff(table);
          else {
            setHours('1');
            setPopupError('');
            setOpenTable(table);
          }
        }}
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-xl py-4">
      <div className="rounded-lg bg-white px-6 py-8 shadow-sm">
        <h1 className="mb-6 text-center text-2xl font-medium tracking-wide">預留時段設備控制</h1>
        {row('枱號1', '1', table1)}
        {row('枱號2', '2', table2)}
        <div className="flex items-center justify-between gap-4 py-5">
          <div>
            <p className="text-xl font-black tracking-wide">全開關</p>
            <p className="mt-1 text-sm text-neutral-700">當枱號1及2<br />同時開啟時生效</p>
            {bothOn && allOffPassword && (
              <p className="mt-1 flex items-center gap-1 text-sm text-neutral-800">
                關閉密碼：{allOffPassword}
                <CopyButton value={allOffPassword} />
              </p>
            )}
          </div>
          <PowerSwitch label="全開關" on={bothOn} enabled={ready && !pending && bothOn} onClick={() => void turnOffAll()} />
        </div>
        {statusText && <p className="pt-2 text-sm text-muted-foreground">{statusText}</p>}
        {error && <p className="pt-2 text-sm text-destructive">{error}</p>}
      </div>

      <Dialog open={openTable !== null} onOpenChange={(open) => { if (!open && !pending) { setOpenTable(null); setPopupError(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>開啟枱號{openTable}預留</DialogTitle>
            <DialogDescription>由按下確定的時間開始，結束時間會補到下一個 00 或 30 分。</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm">
            時數
            <select className="h-10 rounded-md border bg-background px-3" value={hours} onChange={(event) => setHours(event.target.value)} disabled={pending}>
              {DURATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          {popupError && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{popupError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => { setOpenTable(null); setPopupError(''); }}>返回</Button>
            <Button type="button" disabled={pending} onClick={() => void confirmOn()}>確定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
