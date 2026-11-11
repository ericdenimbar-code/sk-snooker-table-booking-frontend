'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { submitClosedoorPasscode } from './actions';

const DIGIT_COUNT = 4;

export function ClosedoorClientPage() {
  const [digits, setDigits] = useState<string[]>(() => Array(DIGIT_COUNT).fill(''));
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const passcode = digits.join('');

  const focusAt = (index: number) => {
    const target = inputs.current[Math.max(0, Math.min(index, DIGIT_COUNT - 1))];
    target?.focus();
    target?.select();
  };

  const writeDigits = (start: number, raw: string) => {
    const incoming = raw.replace(/\D/g, '');
    if (!incoming) {
      setDigits((current) => current.map((digit, index) => (index === start ? '' : digit)));
      return;
    }
    setDigits((current) => {
      const next = [...current];
      for (let offset = 0; offset < incoming.length && start + offset < DIGIT_COUNT; offset++) {
        next[start + offset] = incoming[offset];
      }
      return next;
    });
    focusAt(Math.min(start + incoming.length, DIGIT_COUNT - 1));
  };

  const handleSubmit = async () => {
    setError('');
    setSuccess('');
    if (!/^\d{4}$/.test(passcode)) {
      setError('請輸入 4 位數字密碼。');
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitClosedoorPasscode(passcode);
      if (result.status === 'ok') {
        setSuccess(result.message);
        setDigits(Array(DIGIT_COUNT).fill(''));
        return;
      }
      setError(result.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-lg py-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">結束預留時段</h1>
          <p className="text-sm text-muted-foreground">
            請輸入該枱預留時段的 4 位密碼。時段開始後輸入正確密碼，該段會結束於現在，餘下時間可再預約。
          </p>
        </div>

        <form
          className="space-y-5"
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
          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-3">
            <p id="closedoor-passcode-label" className="text-sm font-medium">4 位數字密碼</p>
            <div className="flex justify-center gap-3" role="group" aria-labelledby="closedoor-passcode-label">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(node) => { inputs.current[index] = node; }}
                  value={digit}
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={1}
                  aria-label={`密碼第 ${index + 1} 位`}
                  className="h-16 w-14 rounded-xl border border-input bg-background text-center text-2xl font-medium tabular-nums shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring"
                  onChange={(event) => writeDigits(index, event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onPaste={(event) => {
                    event.preventDefault();
                    writeDigits(index, event.clipboardData.getData('text'));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !digits[index] && index > 0) {
                      event.preventDefault();
                      setDigits((current) => current.map((value, item) => (item === index - 1 ? '' : value)));
                      focusAt(index - 1);
                    } else if (event.key === 'ArrowLeft' && index > 0) {
                      event.preventDefault();
                      focusAt(index - 1);
                    } else if (event.key === 'ArrowRight' && index < DIGIT_COUNT - 1) {
                      event.preventDefault();
                      focusAt(index + 1);
                    }
                  }}
                />
              ))}
            </div>
          </div>
          <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={submitting || passcode.length !== 4}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            確定
          </Button>
        </form>
      </div>
    </div>
  );
}
