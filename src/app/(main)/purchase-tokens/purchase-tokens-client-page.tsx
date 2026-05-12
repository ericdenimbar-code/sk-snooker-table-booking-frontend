'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import type { RoomSettings, PaymentInfo } from '@/app/admin/settings/actions';
import { CreditCard, Smartphone, Loader2, Info, Ban, AlertCircle } from 'lucide-react';
import type { TokenPurchaseRequest, User } from '@/types';
import {
  createTokenPurchaseRequest,
  getTokenPurchaseRequestsByUser,
  cancelTokenPurchaseRequest,
  expireStaleRequestingTokenOrdersForUser,
} from '@/app/admin/token-requests/actions';
import { getUserByEmail } from '@/app/admin/users/actions';
import { db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import Image from 'next/image';

const TOP_UP_AMOUNT_DISCREPANCY_NOTICE =
  '請注意：此記錄與要求金額有出入，我們以最後收到轉帳之金額作最後的充值額。';

type PurchaseHistoryProps = {
  requests: TokenPurchaseRequest[];
  isLoading: boolean;
  refreshHistory: () => void;
};

function PurchaseHistory({ requests, isLoading, refreshHistory }: PurchaseHistoryProps) {
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const { toast } = useToast();

  const getStatusBadge = (status: TokenPurchaseRequest['status']) => {
    switch (status) {
      case 'requesting':
        return <Badge variant="outline" className="text-amber-600 border-amber-500">等待付款</Badge>;
      case 'processing':
        return <Badge className="bg-blue-500 text-white hover:bg-blue-500/80">等待批核</Badge>;
      case 'completed':
        return <Badge className="bg-green-500 text-white hover:bg-green-500/80">已完成</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">已取消</Badge>;
      default:
        return <Badge variant="secondary">未知</Badge>;
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    setIsCancelling(requestId);
    const result = await cancelTokenPurchaseRequest(requestId);
    
    if (result.success) {
      toast({ title: '請求已取消' });
      refreshHistory();
    } else {
      toast({ 
        variant: 'destructive', 
        title: '取消失敗', 
        description: result.error || '發生未知錯誤，請再試一次。' 
      });
    }
    
    setIsCancelling(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>購買紀錄</CardTitle></CardHeader>
        <CardContent className="flex justify-center items-center h-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (requests.length === 0) {
    return (
       <Card>
        <CardHeader><CardTitle>購買紀錄</CardTitle></CardHeader>
        <CardContent>
           <div className="flex flex-col items-center justify-center h-24 border-2 border-dashed rounded-lg">
                <Info className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">您目前沒有任何購買紀錄。</p>
            </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>增值紀錄</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {requests.map(req => (
          <div key={req.id} className="border p-4 rounded-lg space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{req.tokenQuantity} 港幣</p>
                <p className="text-sm text-muted-foreground">HKD ${req.totalPriceHKD.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground pt-1">Ref: {req.id}</p>
              </div>
              <div className="text-right space-y-1">
                {getStatusBadge(req.status)}
                <p className="text-xs text-muted-foreground">
                  {format(new Date(req.requestDate), 'yyyy-MM-dd HH:mm')}
                </p>
              </div>
            </div>
            {req.status === 'completed' && req.hasDiscrepancy && (
              <div
                role="status"
                className="flex gap-2 rounded-md border border-amber-400/70 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-100"
              >
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <span>{TOP_UP_AMOUNT_DISCREPANCY_NOTICE}</span>
              </div>
            )}
            {req.status === 'requesting' && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="w-full" onClick={() => handleCancelRequest(req.id)} disabled={isCancelling !== null}>
                  {isCancelling === req.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4"/>}
                  取消要求
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type PurchaseTokensClientPageProps = {
  settings: RoomSettings;
  paymentInfo: PaymentInfo;
};

export function PurchaseTokensClientPage({ settings, paymentInfo }: PurchaseTokensClientPageProps) {
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [pendingRequestInfo, setPendingRequestInfo] = useState<{ price: number, id: string } | null>(null);
  
  const [requests, setRequests] = useState<TokenPurchaseRequest[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const fetchHistory = useCallback(async (email: string) => {
    setIsLoadingHistory(true);
    const result = await getTokenPurchaseRequestsByUser(email);
    if (result.success && result.requests) {
      setRequests(result.requests);
    } else {
      console.error("Failed to fetch purchase history:", result.error);
      setRequests([]); 
    }
    setIsLoadingHistory(false);
  }, []);

  useEffect(() => {
    const userDataString = localStorage.getItem('user');
    if (!userDataString) {
      setUser(null);
      setIsLoadingHistory(false);
      return;
    }

    let parsedUser: User;
    try {
      parsedUser = JSON.parse(userDataString) as User;
    } catch (error) {
      console.error('Failed to parse user data:', error);
      setIsLoadingHistory(false);
      return;
    }

    setUser(parsedUser);

    if (!parsedUser.email) {
      setIsLoadingHistory(false);
      return;
    }

    (async () => {
      await expireStaleRequestingTokenOrdersForUser(parsedUser.email);
      const fresh = await getUserByEmail(parsedUser.email);
      if (fresh) {
        setUser(fresh);
        localStorage.setItem('user', JSON.stringify(fresh));
      }
      await fetchHistory(parsedUser.email);
    })();
  }, [fetchHistory]);

  useEffect(() => {
    const uid = user?.id;
    if (!uid) {
      return;
    }
    const userRef = doc(db, 'users', uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const tokens = typeof data.tokens === 'number' ? data.tokens : 0;

      setUser((prev) => {
        if (!prev || prev.id !== uid) return prev;
        return {
          ...prev,
          name: typeof data.name === 'string' ? data.name : prev.name,
          phone: typeof data.phone === 'string' ? data.phone : prev.phone,
          role: (data.role as User['role']) ?? prev.role,
          tokens,
        };
      });

      try {
        const raw = localStorage.getItem('user');
        if (!raw) return;
        const cur = JSON.parse(raw) as User;
        if (cur.id !== uid) return;
        localStorage.setItem(
          'user',
          JSON.stringify({
            ...cur,
            name: typeof data.name === 'string' ? data.name : cur.name,
            phone: typeof data.phone === 'string' ? data.phone : cur.phone,
            role: (data.role as User['role']) ?? cur.role,
            tokens,
          }),
        );
      } catch {
        /* ignore */
      }
    },
      (err) => console.error('[purchase-tokens] Firestore users snapshot:', err),
    );

    return () => unsubscribe();
  }, [user?.id]);

  const totalPrice = useMemo(() => {
    const quantity = Number(purchaseQuantity) || 0;
    return quantity * settings.tokenPriceHKD;
  }, [purchaseQuantity, settings.tokenPriceHKD]);

  const blockingRequest = useMemo(
    () => requests.find((r) => r.status === 'requesting' || r.status === 'processing'),
    [requests],
  );

  const handleReset = () => {
    setPurchaseQuantity('');
  };

  const handleConfirm = async () => {
    if (blockingRequest) {
      toast({
        variant: 'destructive',
        title: '無法提交',
        description: '您已有進行中的增值請求，請先完成或等候處理。',
      });
      return;
    }
    const quantity = Number(purchaseQuantity);
    if (!quantity || quantity <= 0) {
      toast({
        variant: 'destructive',
        title: '輸入無效',
        description: '請輸入有效的增值金額。',
      });
      return;
    }

    if (!user) {
       toast({
        variant: 'destructive',
        title: '無法提交',
        description: '無法取得使用者資料，請重新登入。',
      });
      return;
    }

    setIsSubmitting(true);
    
    const requestData: Omit<TokenPurchaseRequest, 'id' | 'status' | 'requestDate' | 'paymentProofUrl' | 'completionDate' | 'expiresAt'> & { paymentMethod: TokenPurchaseRequest['paymentMethod'] } = {
        userEmail: user.email,
        userName: user.name,
        userPhone: user.phone,
        tokenQuantity: quantity,
        totalPriceHKD: totalPrice,
        paymentMethod: 'fps',
    };

    const result = await createTokenPurchaseRequest(requestData);

    if (result.success && result.newRequest) {
      const newRequest = result.newRequest as TokenPurchaseRequest;
      setPurchaseQuantity(''); 
      
      setRequests(prevRequests => [newRequest, ...prevRequests]);
      
      setPendingRequestInfo({ price: totalPrice, id: newRequest.id });
      setIsInfoDialogOpen(true);
    } else {
       toast({
        variant: 'destructive',
        title: '提交失敗',
        description: result.error || '發生未知錯誤，請稍後再試。',
      });
    }
    
    setIsSubmitting(false);
  };
  
  const handleInfoDialogClose = (isOpen: boolean) => {
    setIsInfoDialogOpen(isOpen);
  };
  
  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      setPurchaseQuantity('');
    } else {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue) && numValue >= 0) {
        setPurchaseQuantity(numValue);
      }
    }
  };

  return (
    <main className="flex flex-1 flex-col items-center p-4 sm:p-8 space-y-6">
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>您目前的帳戶餘額</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {user === null ? (
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            ) : (
              <div className="text-center">
                <p className="text-6xl font-bold text-primary">{user.tokens ?? 0}</p>
                <p className="text-muted-foreground">港幣</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>帳戶增值流程</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {settings.purchaseTokensIntro}
            </p>
          </CardContent>
        </Card>
      </div>
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>增值帳戶</CardTitle>
            <CardDescription>輸入您想增值的金額，並選擇付款方式。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {blockingRequest && (
              <div
                role="alert"
                className="flex gap-3 rounded-lg border border-orange-300/90 bg-orange-100 px-4 py-4 text-orange-950 shadow-sm dark:border-orange-700/60 dark:bg-orange-950/50 dark:text-orange-100"
              >
                <AlertCircle className="h-6 w-6 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
                <div className="space-y-1 text-sm leading-relaxed">
                  <p className="text-base font-semibold text-amber-950 dark:text-amber-50">已有進行中的增值請求</p>
                  <p className="text-amber-900 dark:text-amber-100/95">
                    {blockingRequest.status === 'requesting'
                      ? '您有一筆「等待付款」的增值請求'
                      : '您有一筆「等待批核」的增值請求'}
                    （參考編號{' '}
                    <span className="font-mono font-bold tracking-tight">{blockingRequest.id}</span>
                    ）。請完成或等候處理後再提交新申請。逾時未付款的請求會在進入本頁時由系統自動取消。
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="quantity">增值金額 (港幣)</Label>
              <Input
                id="quantity"
                type="number"
                placeholder="例如：100"
                value={purchaseQuantity}
                onChange={handleQuantityChange}
                min="1"
              />
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">所需價目: <span className="text-2xl text-primary">HKD ${totalPrice.toFixed(2)}</span></p>
              <p className="text-xs text-muted-foreground">(1 港幣 = 1 餘額)</p>
            </div>
            <div className="grid gap-2">
                <Label>付款方式</Label>
                <RadioGroup
                    defaultValue="fps"
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                >
                    <Label htmlFor="r-cc" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 opacity-50 cursor-not-allowed">
                        <RadioGroupItem value="cc" id="r-cc" className="sr-only" disabled />
                        <CreditCard className="mb-3 h-6 w-6" />
                        信用卡 (暫未開放)
                    </Label>
                    <Label htmlFor="r-fps" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary cursor-pointer">
                         <RadioGroupItem value="fps" id="r-fps" className="sr-only" />
                        <Smartphone className="mb-3 h-6 w-6" />
                        轉數快 (FPS)
                    </Label>
                </RadioGroup>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset}>重設</Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || !purchaseQuantity || !!blockingRequest}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定
            </Button>
          </CardFooter>
        </Card>
      </div>

      <div className="w-full max-w-2xl">
        <PurchaseHistory 
          requests={requests}
          isLoading={isLoadingHistory}
          refreshHistory={() => {
            if (!user?.email) return;
            void (async () => {
              const fresh = await getUserByEmail(user.email);
              if (fresh) {
                setUser(fresh);
                localStorage.setItem('user', JSON.stringify(fresh));
              }
              await fetchHistory(user.email);
            })();
          }}
        />
      </div>

       <Dialog open={isInfoDialogOpen} onOpenChange={handleInfoDialogClose}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>付款資訊</DialogTitle>
                <DialogDescription asChild>
                    <div className="space-y-1 text-center">
                        <p>感謝您的增值請求</p>
                        <p>請使用您的銀行 App 掃描以下 FPS QR Code，或手動轉帳款項</p>
                        <p className="text-2xl font-bold text-primary py-1">HKD ${pendingRequestInfo?.price.toFixed(2)}</p>
                        <p>當我們確認收到款項後，會立即幫你充值。您無需上傳任何證明。</p>
                    </div>
                </DialogDescription>
            </DialogHeader>
            <div className="my-2 space-y-3">
              {paymentInfo.staticFpsQrCodeUrl ? (
                <div className="text-center">
                  <div className="mx-auto bg-white p-2 border rounded-md inline-block">
                    <Image src={paymentInfo.staticFpsQrCodeUrl} alt="Static FPS QR Code" width={200} height={200} />
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground p-4 border rounded-md">
                    管理員尚未上傳收款 QR Code。
                </div>
              )}
               <div className="text-center space-y-1 border-t pt-3">
                 <p className="text-sm text-muted-foreground">或手動輸入：</p>
                 <p><span className="font-semibold">FPS 號碼：</span><span className="text-2xl font-bold text-primary py-1">{paymentInfo.fpsNumber || 'N/A'}</span></p>
                 <p><span className="font-semibold">收款戶口名稱：</span><span className="text-lg font-bold">{paymentInfo.accountHolderName || 'N/A'}</span></p>
                 <p className="text-xs text-muted-foreground pt-2">請在轉帳時於備註欄輸入您的請求參考編號: <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{pendingRequestInfo?.id}</span></p>
               </div>
            </div>
            <DialogFooter>
                <Button onClick={() => handleInfoDialogClose(false)}>明白，稍後轉帳</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}