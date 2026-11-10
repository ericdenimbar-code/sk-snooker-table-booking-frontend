'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { submitClosedoorPasscode } from './actions';

export function ClosedoorClientPage() {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
        setPasscode('');
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
          {success && (
            <Alert>
              <AlertDescription>{success}</AlertDescription>
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
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            確定
          </Button>
        </form>
      </div>
    </div>
  );
}
