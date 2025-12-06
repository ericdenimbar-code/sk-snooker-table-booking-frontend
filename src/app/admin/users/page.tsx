'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User } from './actions';
import { Button } from '@/components/ui/button';
import { UserPlus, FileUp, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { UsersTable } from './users-table';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getAllUsers } from './actions';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const syncUsers = useCallback(async (isManual: boolean) => {
    if (isManual) {
      setIsSyncing(true);
      toast({ title: '正在手動同步...', description: '正在從後端資料庫重新整理使用者資料。' });
    } else {
      setIsLoading(true);
    }

    const result = await getAllUsers();

    if (result.success && result.users) {
      const freshUsers: User[] = result.users;
      freshUsers.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      setUsers(freshUsers);
      
      if (isManual) {
        toast({ title: '同步成功', description: `已成功從資料庫載入 ${freshUsers.length} 位使用者。` });
      }
    } else {
      toast({ 
        variant: 'destructive', 
        title: isManual ? '手動同步失敗' : '自動同步失敗', 
        description: `${result.error || '無法從資料庫獲取最新資料。'}`
      });
    }

    if (isManual) {
      setIsSyncing(false);
    } else {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    syncUsers(false);
  }, [syncUsers]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">使用者管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            頁面開啟時會自動与資料庫同步。如遇資料延遲，可手動同步。
          </p>
        </div>
        <div className="flex gap-2">
           <Button variant="outline" onClick={() => syncUsers(true)} disabled={isSyncing}>
              {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              手動同步
            </Button>
          <Button variant="outline" disabled>
            <FileUp className="mr-2 h-4 w-4" /> 匯出
          </Button>
          <Button disabled>
            <UserPlus className="mr-2 h-4 w-4" /> 新增使用者
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
             <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <UsersTable 
              users={users}
              setUsers={setUsers}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
