'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { generateHalfHourSlots } from '@/lib/blocked-slots';
import { parseHm, shutdownWindowCrossesMidnight } from '@/lib/facility-shutdown-window';
import {
  getFacilityShutdownSettings,
  refreshFacilityShutdownPasscode,
  saveFacilityShutdown,
  type FacilityShutdownSettingsView,
} from './actions';

function randomPasscode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(value).padStart(4, '0');
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function FacilityShutdownClientPage() {
  const { toast } = useToast();
  const slots = useMemo(() => generateHalfHourSlots(), []);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [triggeredAtLabel, setTriggeredAtLabel] = useState<string | null>(null);
  const triggeredAtIso = useRef<string | null>(null);
  const initialized = useRef(false);

  const applySettings = useCallback((settings: FacilityShutdownSettingsView, announceTrigger: boolean) => {
    setTriggeredAtLabel(settings.triggeredAtLabel);
    if (!initialized.current) {
      initialized.current = true;
      triggeredAtIso.current = settings.triggeredAtIso;
      if (settings.isActive && settings.passcode && settings.startTime && settings.endTime) {
        setPasscode(settings.passcode);
        setStartTime(settings.startTime);
        setEndTime(settings.endTime);
        setIsActive(true);
      } else {
        setPasscode(randomPasscode());
        setStartTime('');
        setEndTime('');
        setIsActive(false);
      }
      return;
    }

    const triggered = settings.triggeredAtIso && settings.triggeredAtIso !== triggeredAtIso.current;
    if (triggered) {
      triggeredAtIso.current = settings.triggeredAtIso;
      setIsActive(false);
      setStartTime('');
      setEndTime('');
      setPasscode(randomPasscode());
      if (announceTrigger) {
        toast({ title: '離場關機已觸發', description: '密碼已作廢，可以重新設定。' });
      }
    }
  }, [toast]);

  const load = useCallback(async (userId: string, announceTrigger: boolean) => {
    const result = await getFacilityShutdownSettings(userId);
    if (!result.success) {
      toast({ variant: 'destructive', title: '載入失敗', description: result.error });
      return;
    }
    applySettings(result.settings, announceTrigger);
  }, [applySettings, toast]);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (!raw) {
      setLoading(false);
      return;
    }
    try {
      const user = JSON.parse(raw) as { id?: string };
      if (!user.id) {
        setLoading(false);
        return;
      }
      setAdminUserId(user.id);
      void load(user.id, false).finally(() => setLoading(false));
    } catch {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!adminUserId) return;
    const timer = window.setInterval(() => {
      void load(adminUserId, true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [adminUserId, load]);

  const crossesMidnight = startTime && endTime ? shutdownWindowCrossesMidnight(startTime, endTime) : false;

  const handleRefresh = async () => {
    if (!isActive) {
      setPasscode(randomPasscode());
      return;
    }
    if (!adminUserId) return;
    setSaving(true);
    try {
      const result = await refreshFacilityShutdownPasscode(adminUserId);
      if (!result.success) {
        toast({ variant: 'destructive', title: '無法更新密碼', description: result.error });
        return;
      }
      setPasscode(result.passcode);
      toast({ title: '已換一組密碼' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!adminUserId) return;
    if (parseHm(startTime) === null || parseHm(endTime) === null) {
      toast({ variant: 'destructive', title: '請選擇開始與結束時間' });
      return;
    }
    if (startTime === endTime) {
      toast({ variant: 'destructive', title: '開始與結束時間不能相同' });
      return;
    }
    setSaving(true);
    try {
      const result = await saveFacilityShutdown({
        adminUserId,
        passcode,
        startTime,
        endTime,
      });
      if (!result.success) {
        toast({ variant: 'destructive', title: '無法儲存', description: result.error });
        return;
      }
      setIsActive(true);
      setPasscode(result.settings.passcode ?? passcode);
      setStartTime(result.settings.startTime ?? startTime);
      setEndTime(result.settings.endTime ?? endTime);
      toast({ title: '已儲存離場關機設定' });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !passcode) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <div className="flex items-center justify-center gap-3">
          <p className="text-5xl font-bold tracking-[0.35em] tabular-nums">{passcode}</p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void handleRefresh()}
            disabled={saving}
            aria-label="重新整理"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {isActive ? '此密碼已生效。按下重新整理會立即換成另一組。' : '此密碼尚未儲存。可先重新整理，再按確定寫入。'}
        </p>
        {triggeredAtLabel && (
          <p className="text-sm">最後觸發時間：{triggeredAtLabel}（香港時間）</p>
        )}
      </div>

      <div>
        <h3 className="text-lg font-medium mb-2">選擇生效時段</h3>
        <p className="text-sm text-muted-foreground mb-4">
          以香港時間計算。例如 22:00 至次日 04:00，凌晨 01:00 仍算在時段內。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="shutdown-start">開始時間</Label>
            <select
              id="shutdown-start"
              className={selectClass}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            >
              <option value="">請選擇</option>
              {slots.map((slot) => (
                <option key={slot} value={slot}>{slot}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="shutdown-end">結束時間</Label>
            <select
              id="shutdown-end"
              className={selectClass}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            >
              <option value="">請選擇</option>
              {slots.map((slot) => (
                <option key={`end-${slot}`} value={slot}>{slot}</option>
              ))}
            </select>
          </div>
        </div>
        {crossesMidnight && (
          <p className="mt-3 text-sm text-muted-foreground">結束時間早於開始時間，會視為跨日至次日。</p>
        )}
      </div>

      <Button type="button" size="lg" className="w-full" disabled={saving} onClick={() => void handleSave()}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        確定
      </Button>
    </div>
  );
}
