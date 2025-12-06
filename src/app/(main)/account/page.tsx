'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, User as UserIcon, Mail, Phone, Award } from 'lucide-react';
import type { User as AppUser } from '@/app/admin/users/actions';
import { getUserByEmail } from '@/app/admin/users/actions';

export default function AccountPage() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserData() {
      setIsLoading(true);
      setError(null);
      const userDataString = localStorage.getItem('user');
      if (!userDataString) {
        setError('找不到使用者登入資訊，請重新登入。');
        setIsLoading(false);
        return;
      }

      try {
        const loggedInUser: { email: string } = JSON.parse(userDataString);
        
        // Directly fetch the latest user profile from the server
        const latestUser = await getUserByEmail(loggedInUser.email);
        
        if (latestUser) {
          setUser(latestUser);
        } else {
          setError('無法從伺服器獲取最新的使用者資料。');
        }
      } catch (e: any) {
        console.error('Failed to fetch or parse user data:', e);
        setError('載入使用者資料時發生錯誤。');
      } finally {
        setIsLoading(false);
      }
    }

    fetchUserData();
  }, []);

  const getRoleBadge = (role: AppUser['role']) => {
    // Make it case-insensitive for robustness
    switch (role.toLowerCase()) {
      case 'admin':
        return <Badge variant="destructive">管理員</Badge>;
      case 'vvip':
        return <Badge className="bg-purple-600 text-white hover:bg-purple-600/80">VVIP</Badge>;
      case 'vip':
        return <Badge variant="secondary" className="bg-yellow-400 text-black hover:bg-yellow-400/80">VIP</Badge>;
      case 'user':
      default:
        return <Badge variant="outline">普通使用者</Badge>;
    }
  };

  const InfoRow = ({ icon, label, value }: { icon: React.ReactNode, label: string, value: React.ReactNode }) => (
    <div className="flex items-start justify-between border-b py-4 last:border-none last:pb-0">
      <div className="flex items-center gap-4">
        <div className="text-muted-foreground">{icon}</div>
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="font-medium text-right">{value}</div>
    </div>
  );

  return (
    <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>我的帳戶資料</CardTitle>
            <CardDescription>此處顯示您的個人資訊。如需修改，請聯絡管理員。</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg text-destructive">
                <p>{error}</p>
              </div>
            ) : user ? (
              <div className="space-y-2">
                <InfoRow icon={<UserIcon className="h-5 w-5"/>} label="會員名稱" value={user.name} />
                <InfoRow icon={<Mail className="h-5 w-5"/>} label="會員電郵" value={user.email} />
                <InfoRow icon={<Phone className="h-5 w-5"/>} label="會員電話號碼" value={user.phone || '未提供'} />
                <InfoRow icon={<Award className="h-5 w-5"/>} label="等級" value={getRoleBadge(user.role)} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg">
                <p className="text-muted-foreground">無法載入使用者資料。請重新登入。</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
