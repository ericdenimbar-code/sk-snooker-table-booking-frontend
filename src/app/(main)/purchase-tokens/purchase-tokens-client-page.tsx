
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
import { CreditCard, Smartphone, Mail, Loader2, Info, UploadCloud, CheckCircle, Ban, AlertTriangle } from 'lucide-react';
import type { TokenPurchaseRequest } from '@/types';
import { createTokenPurchaseRequest, getTokenPurchaseRequestsByUser, submitPaymentProof, cancelTokenPurchaseRequest } from '@/app/admin/token-requests/actions';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import Image from 'next/image';
import { generateFpsQrCodeUrl } from '@/lib/fps-qrcode';

type PurchaseHistoryProps = {
  requests: TokenPurchaseRequest[];
  isLoading: boolean;
  setRequests: React.Dispatch<React.SetStateAction<TokenPurchaseRequest[]>>;
  refreshHistory: () => void;
};

type User = {
  name: string;
  email: string;
  phone: string;
  role: 'admin' | 'user';
  tokens?: number;
};

function PurchaseHistory({ requests, isLoading, setRequests, refreshHistory }: PurchaseHistoryProps) {
  const [isSubmittingProof, setIsSubmittingProof] = useState(false);
  const [isProofDialogOpen, setIsProofDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<TokenPurchaseRequest | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  const handleOpenProofDialog = (request: TokenPurchaseRequest) => {
    setSelectedRequest(request);
    setSelectedFile(null);
    setIsProofDialogOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSubmitProof = async () => {
    if (!selectedFile || !selectedRequest) return;
    setIsSubmittingProof(true);

    const fileToDataUrl = (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
      });
    };

    try {
      const base64Url = await fileToDataUrl(selectedFile);
      const result = await submitPaymentProof(selectedRequest.id, base64Url);

      if (result.success && result.updatedRequest) {
        toast({ title: '上傳成功', description: '您的付款證明已提交，管理員將盡快處理。' });
        
        setRequests(prevRequests => 
          prevRequests.map(req => 
            req.id === selectedRequest.id 
              ? result.updatedRequest
              : req
          )
        );
        
        setIsProofDialogOpen(false);
      } else {
        throw new Error(result.error || '發生伺服器端錯誤。');
      }
    } catch (error: any) {
      console.error("Payment proof upload failed:", error);
      toast({ variant: 'destructive', title: '上傳失敗', description: error.message || '發生未知錯誤，請再試一次。' });
    } finally {
      setIsSubmittingProof(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    setIsCancelling(requestId);
    const result = await cancelTokenPurchaseRequest(requestId);
    
    if (result.success) {
      toast({ title: '請求已取消' });
      // Re-fetch to get accurate status, especially if tokens were refunded.
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
    <>
      <Card>
        <CardHeader><CardTitle>增值紀錄</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {requests.map(req => {
            return (
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
                 {req.status === 'requesting' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="flex-1" onClick={() => handleOpenProofDialog(req)} disabled={isCancelling !== null}>
                        <UploadCloud className="mr-2 h-4 w-4" />
                        上傳付款證明
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleCancelRequest(req.id)} disabled={isCancelling !== null}>
                        {isCancelling === req.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        取消要求
                      </Button>
                    </div>
                  </div>
                )}
                 {req.status === 'processing' && (
                    <div className="flex items-center justify-center text-sm text-blue-600 bg-blue-50 p-2 rounded-md">
                        <CheckCircle className="mr-2 h-4 w-4" />
                        已提交證明，等候管理員批核
                    </div>
                 )}
                 {req.status === 'completed' && req.completionDate && (
                    <div className="flex items-center justify-center text-sm text-green-600 bg-green-50 p-2 rounded-md">
                        <CheckCircle className="mr-2 h-4 w-4" />
                        此交易已於 {format(new Date(req.completionDate), 'yyyy-MM-dd')} 完成
                    </div>
                 )}
                 {req.status === 'cancelled' && (
                    <div className="flex items-center justify-center text-sm text-red-600 bg-red-50 p-2 rounded-md">
                        <Ban className="mr-2 h-4 w-4" />
                        此交易已被取消
                    </div>
                 )}
              </div>
            )
          })}
        </CardContent>
      </Card>
      
      <Dialog open={isProofDialogOpen} onOpenChange={setIsProofDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上傳付款證明</DialogTitle>
            <DialogDescription>
              為訂單 {selectedRequest?.id} 上傳您的付款截圖或收據。
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input type="file" accept="image/*" onChange={handleFileChange} />
             {selectedFile && <p className="text-sm text-muted-foreground mt-2">已選擇檔案：{selectedFile.name}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProofDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmitProof} disabled={!selectedFile || isSubmittingProof}>
              {isSubmittingProof && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定上傳
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type PurchaseTokensClientPageProps = {
  settings: RoomSettings;
  paymentInfo: PaymentInfo;
};

export function PurchaseTokensClientPage({ settings, paymentInfo }: PurchaseTokensClientPageProps) {
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [purchaseQuantity, setPurchaseQuantity] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState('fps');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const [pendingRequestInfo, setPendingRequestInfo] = useState<{ price: number, id: string } | null>(null);
  
  const [requests, setRequests] = useState<TokenPurchaseRequest[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const [fpsQrUrl, setFpsQrUrl] = useState('');

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
    if (userDataString) {
      try {
        const parsedUser: User = JSON.parse(userDataString);
        setUser(parsedUser);
        if (parsedUser.email) {
            fetchHistory(parsedUser.email);
        } else {
            setIsLoadingHistory(false);
        }
      } catch (error) {
        console.error('Failed to parse user data:', error);
        setIsLoadingHistory(false);
      }
    } else {
      setIsLoadingHistory(false);
    }
  }, [fetchHistory]);

  const totalPrice = useMemo(() => {
    const quantity = Number(purchaseQuantity) || 0;
    return quantity * settings.tokenPriceHKD;
  }, [purchaseQuantity, settings.tokenPriceHKD]);

  const handleReset = () => {
    setPurchaseQuantity('');
  };

  const handleConfirm = async () => {
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
        paymentMethod: paymentMethod as TokenPurchaseRequest['paymentMethod'],
    };

    const result = await createTokenPurchaseRequest(requestData);

    if (result.success && result.newRequest) {
      const newRequest = result.newRequest as TokenPurchaseRequest;
      setPurchaseQuantity(''); 
      
      setRequests(prevRequests => [newRequest, ...prevRequests]);
      
      const newPendingInfo = { price: totalPrice, id: newRequest.id };
      setPendingRequestInfo(newPendingInfo);
      
      // Generate QR URL here after setting pending info
      if (paymentInfo.fpsNumber) {
        const url = await generateFpsQrCodeUrl(paymentInfo.fpsNumber, newPendingInfo.price, newPendingInfo.id);
        setFpsQrUrl(url);
      }
      
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
    if (!isOpen) { 
        toast({
            title: '請求已送出',
            description: '您的增值請求已在下方紀錄中更新，請記得上傳付款證明。',
        });
    }
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
                    value={paymentMethod}
                    onValueChange={setPaymentMethod}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4"
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
                    <Label htmlFor="r-admin" className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary cursor-pointer">
                         <RadioGroupItem value="admin" id="r-admin" className="sr-only" />
                        <Mail className="mb-3 h-6 w-6" />
                        聯絡管理員增值
                    </Label>
                </RadioGroup>
            </div>
          </CardContent>
          <CardFooter className="flex justify-end gap-2">
            <Button variant="outline" onClick={handleReset}>重設</Button>
            <Button onClick={handleConfirm} disabled={isSubmitting || !purchaseQuantity}>
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
          setRequests={setRequests}
          refreshHistory={() => user?.email ? fetchHistory(user.email) : undefined}
        />
      </div>

       <Dialog open={isInfoDialogOpen} onOpenChange={handleInfoDialogClose}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>感謝您的增值請求</DialogTitle>
                <DialogDescription>
                    請使用您的銀行 App 掃描以下 FPS QR Code，或手動轉帳款項 <span className="font-bold text-primary">HKD ${pendingRequestInfo?.price.toFixed(2)}</span>。完成後請於本頁的增值紀錄中**上傳付款證明**。
                </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-4">
              {paymentMethod === 'fps' && fpsQrUrl ? (
                <div className="text-center space-y-2">
                  <p className="text-sm font-semibold">請掃描 FPS QR Code</p>
                  <div className="mx-auto bg-white p-2 border rounded-md inline-block">
                    <Image src={fpsQrUrl} alt="FPS QR Code" width={200} height={200} />
                  </div>
                  <p className="text-xs text-muted-foreground">參考編號: {pendingRequestInfo?.id}</p>
                </div>
              ) : (
                <div className="rounded-md border bg-muted p-4 whitespace-pre-wrap text-sm">
                    {paymentInfo.bankDetails}
                </div>
              )}
            </div>
            <DialogFooter>
                <Button onClick={() => handleInfoDialogClose(false)}>明白，稍後上傳</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
