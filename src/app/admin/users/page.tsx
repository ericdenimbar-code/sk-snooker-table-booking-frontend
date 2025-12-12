
'use server';

import { Card, CardContent } from '@/components/ui/card';
import { UsersTable } from './users-table';
import { getAllUsers } from './actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Terminal } from 'lucide-react';
import { db } from '@/lib/firebase-admin';


export default async function AdminUsersPage() {

    if (!db) {
        return (
            <div className="flex flex-col gap-6">
                <h1 className="text-lg font-semibold md:text-2xl">使用者管理</h1>
                <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        無法連接至 Firebase。請前往「連線狀態」頁面以查看詳細的連線狀態檢查。
                    </AlertDescription>
                </Alert>
            </div>
        )
    }

    const result = await getAllUsers();
    
    if (!result.success || !result.users) {
        return (
             <div className="flex flex-col gap-6">
                <h1 className="text-lg font-semibold md:text-2xl">使用者管理</h1>
                <Alert variant="destructive">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>資料讀取錯誤</AlertTitle>
                    <AlertDescription>
                        {result.error}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }
  

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start sm:items-center justify-between flex-col sm:flex-row gap-4">
        <div>
          <h1 className="text-lg font-semibold md:text-2xl">使用者管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理您系統中的所有使用者。
          </p>
        </div>
      </div>
       <Card>
            <CardContent className="p-0">
                <UsersTable 
                    initialUsers={result.users}
                />
            </CardContent>
        </Card>
    </div>
  );
}
