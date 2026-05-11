'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { getAdminAlertEmailsAction, saveAdminAlertEmailsAction } from './admin-config-actions';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitCommaLine(line: string): string[] {
  return line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AlertEmailsSettings() {
  const { toast } = useToast();
  const [rows, setRows] = useState<string[]>(['']);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const res = await getAdminAlertEmailsAction();
    if (res.success && res.emails) {
      setRows(res.emails.length > 0 ? res.emails : ['']);
    } else {
      toast({
        variant: 'destructive',
        title: '無法載入設定',
        description: res.error || '請稍後再試。',
      });
      setRows(['']);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (index: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? value : r)));
  };

  const addRow = () => setRows((prev) => [...prev, '']);

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length <= 1 ? [''] : prev.filter((_, i) => i !== index)));
  };

  const validateRows = (): string | null => {
    const flat: string[] = [];
    for (const line of rows) {
      flat.push(...splitCommaLine(line));
    }
    const unique = [...new Set(flat)];
    const bad = unique.filter((e) => !EMAIL_RE.test(e));
    if (bad.length > 0) {
      return `以下電郵格式不正確：${bad.join(', ')}`;
    }
    return null;
  };

  const handleSave = async () => {
    const flat: string[] = [];
    for (const line of rows) {
      flat.push(...splitCommaLine(line));
    }
    const unique = [...new Set(flat)];

    const clientErr = validateRows();
    if (clientErr) {
      toast({ variant: 'destructive', title: '校驗失敗', description: clientErr });
      return;
    }

    setIsSaving(true);
    const res = await saveAdminAlertEmailsAction(unique);
    setIsSaving(false);

    if (res.success) {
      toast({ title: '已儲存', description: `共 ${unique.length} 個警報電郵。` });
      if (res.emails) {
        setRows(res.emails.length > 0 ? res.emails : ['']);
      }
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: res.error || '請稍後再試。',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>警報接收設定</CardTitle>
        <CardDescription>
          當系統偵測到問題交易（例如多筆訂單同時符合轉帳金額）時，會向以下電郵發送通知。可輸入多個電郵，或使用「新增電郵」增加欄位；單一欄位內亦可用逗號分隔多個地址。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((value, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1 grid gap-1.5">
                    {index === 0 && <Label htmlFor={`alert-email-${index}`}>電郵地址</Label>}
                    <Input
                      id={`alert-email-${index}`}
                      type="email"
                      autoComplete="email"
                      placeholder="admin@example.com 或 admin1@a.com, admin2@b.com"
                      value={value}
                      onChange={(e) => updateRow(index, e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => removeRow(index)}
                    aria-label="移除此列"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                新增電郵
              </Button>
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                儲存設定
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
