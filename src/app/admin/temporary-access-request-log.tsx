'use client';

import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { listTemporaryAccessApplications } from '@/app/(main)/temporary-access/actions';
import type { TemporaryAccess } from '@/types';
import { useToast } from '@/hooks/use-toast';

export function TemporaryAccessRequestLog() {
  const { toast } = useToast();
  const [items, setItems] = useState<TemporaryAccess[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (!raw) return;
    try {
      const u = JSON.parse(raw) as { id?: string };
      if (u.id) setAdminUserId(u.id);
    } catch {
      /* ignore */
    }
  }, []);

  const loadPage = useCallback(
    async (append: boolean, cursorId: string | null) => {
      if (!adminUserId) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      const res = await listTemporaryAccessApplications({
        adminUserId,
        pageSize: 10,
        cursorId: append ? cursorId : null,
      });
      if (!res.success || !res.items) {
        toast({
          variant: 'destructive',
          title: '載入失敗',
          description: res.error ?? '無法讀取紀錄。',
        });
        if (!append) setItems([]);
      } else {
        setItems((prev) => (append ? [...prev, ...res.items!] : res.items!));
        setNextCursor(res.nextCursor ?? null);
      }
      setLoading(false);
      setLoadingMore(false);
    },
    [adminUserId, toast],
  );

  useEffect(() => {
    if (!adminUserId) {
      setLoading(false);
      return;
    }
    void loadPage(false, null);
  }, [adminUserId, loadPage]);

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    void loadPage(true, nextCursor);
  };

  if (!adminUserId) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>臨時進出碼 · 申請紀錄</CardTitle>
        <CardDescription>依申請時間新至舊排列；首次顯示最近 10 筆。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚無紀錄（或舊資料未含 createdAt 欄位）。</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {items.map((row) => (
              <li key={row.id} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="space-y-1">
                  <p className="font-medium">
                    {row.recipientEmail ?? row.userEmail}{' '}
                    <span className="text-muted-foreground font-normal">（申請人 {row.userEmail}）</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.segmentKey ? `時段 ${row.segmentKey}` : '—'} · 狀態 {row.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(parseISO(row.validFrom), 'yyyy-MM-dd HH:mm')} →{' '}
                    {format(parseISO(row.validUntil), 'yyyy-MM-dd HH:mm')}
                  </p>
                </div>
                <code className="mt-2 truncate text-xs sm:mt-0 sm:text-right" title={row.sharedSecret ?? row.id}>
                  {row.sharedSecret ?? row.id}
                </code>
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <Button type="button" variant="outline" onClick={handleLoadMore} disabled={loadingMore} className="w-full sm:w-auto">
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            載入更多
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
