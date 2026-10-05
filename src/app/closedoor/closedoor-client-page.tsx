'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { confirmClosedoorShutdown, getClosedoorAvailability, submitClosedoorPasscode } from './actions';

const CLOSED_MESSAGE = '現在非聚會時段，離場關機只限於聚會時段內開啟';
const SUCCESS_MESSAGE = '感謝您的光臨，所有器材會於 2 分鐘內關閉，請檢查隨身物品有沒有遺漏。期待下次再次光臨';

type Phase = 'loading' | 'closed' | 'form' | 'done';

export function ClosedoorClientPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(120);

  const refreshAvailability = useCallback(async () => {
    const result = await getClosedoorAvailability();
    if (!result.open) {
      setConfirmOpen(false);
      setTicket(null);
    }
    setPhase((current) => {
      if (current === 'done') return current;
      return result.open ? 'form' : 'closed';
    });
  }, []);

  useEffect(() => {
    void refreshAvailability();
    const timer = window.setInterval(() => {
      void refreshAvailability();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [refreshAvailability]);

  useEffect(() => {
    if (phase !== 'done') return;
    const endsAt = Date.now() + 120_000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        window.clearInterval(timer);
        window.location.assign('/');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const handleSubmit = async () => {
    setError('');
    if (!/^\d{4}$/.test(passcode)) {
      setError('請輸入 4 位數字密碼。');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitClosedoorPasscode(passcode);
      if (result.status === 'closed') {
        setConfirmOpen(false);
        setTicket(null);
        setPhase('closed');
        return;
      }
      if (result.status !== 'ok') {
        setError('密碼不正確');
        return;
      }
      setTicket(result.ticket);
      setConfirmOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    if (!ticket) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await confirmClosedoorShutdown(ticket);
      if (result.status === 'ok') {
        setConfirmOpen(false);
        setTicket(null);
        setPasscode('');
        setSecondsLeft(120);
        setPhase('done');
        return;
      }
      setConfirmOpen(false);
      setTicket(null);
      if (result.status === 'closed') {
        setPhase('closed');
        return;
      }
      if (result.status === 'failed') {
        setError('暫時無法完成關閉，請稍後再試。');
        return;
      }
      setError('密碼不正確或已失效，請重新輸入。');
    } finally {
      setSubmitting(false);
    }
  };

  const minutes = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="container max-w-lg py-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">離場關閉所有器材</h1>
          {phase === 'form' && (
            <p className="text-sm text-muted-foreground">
              如確定需要關閉所有器材，請輸入4位數字密碼（密碼可向管理員索取）
            </p>
          )}
        </div>

        {phase === 'loading' && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {phase === 'closed' && (
          <Alert variant="destructive">
            <AlertTitle>無法開啟</AlertTitle>
            <AlertDescription>{CLOSED_MESSAGE}</AlertDescription>
          </Alert>
        )}

        {phase === 'form' && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="closedoor-passcode">4 位數字密碼</Label>
              <Input
                id="closedoor-passcode"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={4}
                value={passcode}
                onChange={(event) => setPasscode(event.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || passcode.length !== 4}>
              {submitting && !confirmOpen ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              確定
            </Button>
          </form>
        )}

        {phase === 'done' && (
          <div className="space-y-6">
            <p className="text-base leading-7">{SUCCESS_MESSAGE}</p>
            <p className="text-center text-5xl font-bold tabular-nums">{minutes}:{seconds}</p>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!open && !submitting) { setConfirmOpen(false); setTicket(null); } }}>
        <DialogContent
          onPointerDownOutside={(event) => { if (submitting) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (submitting) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>確認關閉</DialogTitle>
            <DialogDescription className="text-base text-foreground pt-2">
              ⚠️ 按下後所有器材均會關閉並不能重開，如知悉請按確定
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => { setConfirmOpen(false); setTicket(null); }}>
              返回
            </Button>
            <Button type="button" variant="destructive" disabled={submitting} onClick={() => void handleConfirm()}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              確定關閉
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
