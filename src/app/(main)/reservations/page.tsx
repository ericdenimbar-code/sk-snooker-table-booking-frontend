'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { isBefore, isAfter, addHours, parseISO, format, addDays, subHours } from 'date-fns';
import { Calendar, Clock, Hash, Info, Loader2, CircleDollarSign, Ban, Star, Mail, History, QrCode as QrCodeIcon } from 'lucide-react';
import type { Reservation } from '@/types';
import { getAllReservations } from '@/app/(main)/new-reservation/actions';
import { cancelReservation, resendConfirmationEmail } from '@/app/admin/bookings/actions';
import { useToast } from '@/hooks/use-toast';
import { getUserByEmail, type User as AppUser } from '@/app/admin/users/actions';
import qrcode from 'qrcode';
import Image from 'next/image';

type ReservationWithStatus = Reservation & {
  statusDisplay: {
    text: string;
    className: string;
    sortOrder: number;
  };
};

const PAST_RESERVATIONS_CHUNK_SIZE = 3;

export default function ReservationsPage() {
  const [upcomingReservations, setUpcomingReservations] = useState<ReservationWithStatus[]>([]);
  const [pastReservations, setPastReservations] = useState<ReservationWithStatus[]>([]);
  const [visiblePastCount, setVisiblePastCount] = useState(0); // Start with 0 to hide past reservations initially
  
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPast, setIsLoadingPast] = useState(false);
  const [isLoadingQr, setIsLoadingQr] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);
  const { toast } = useToast();
  
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [resendCooldowns, setResendCooldowns] = useState<{ [key: string]: number }>({});
  
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanged = false;
      const newCooldowns = { ...resendCooldowns };
      for (const id in newCooldowns) {
        if (now > newCooldowns[id]) {
          delete newCooldowns[id];
          hasChanged = true;
        }
      }
      if (hasChanged) {
        setResendCooldowns(newCooldowns);
      }
    }, 1000); 

    return () => clearInterval(interval);
  }, [resendCooldowns]);


  const fetchUserReservations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const userDataString = localStorage.getItem('user');
      if (!userDataString) {
        throw new Error('找不到使用者資料，請重新登入。');
      }
      const loggedInUser: { email: string } = JSON.parse(userDataString);

      const [userResult, reservationsResult] = await Promise.all([
        getUserByEmail(loggedInUser.email),
        getAllReservations(loggedInUser.email)
      ]);
      
      if (!userResult) {
        throw new Error('無法從伺服器驗證您的使用者身份。');
      }
      setCurrentUser(userResult);

      if (!reservationsResult.success || !reservationsResult.reservations) {
        throw new Error(reservationsResult.error || '無法從資料庫獲取預訂資料。');
      }

      const userReservations: Reservation[] = reservationsResult.reservations;
      
      const processed = userReservations.map(res => ({
        ...res,
        statusDisplay: getStatus(res),
      }));

      const upcoming = processed
        .filter(r => r.statusDisplay.sortOrder < 3)
        .sort((a, b) => new Date(`${a.date}T${a.startTime}`).getTime() - new Date(`${b.date}T${b.startTime}`).getTime());

      const past = processed
        .filter(r => r.statusDisplay.sortOrder >= 3)
        .sort((a, b) => new Date(b.bookingDate).getTime() - new Date(a.bookingDate).getTime());
      
      setUpcomingReservations(upcoming);
      setPastReservations(past);
      // Keep visiblePastCount at 0 initially

    } catch (err: any) {
      console.error("Failed to fetch reservations:", err);
      setError(err.message || '發生未知錯誤。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserReservations();
  }, [fetchUserReservations]);

  const handleLoadMorePast = () => {
    setIsLoadingPast(true);
    setTimeout(() => {
        setVisiblePastCount(prev => prev === 0 ? PAST_RESERVATIONS_CHUNK_SIZE : prev + PAST_RESERVATIONS_CHUNK_SIZE);
        setIsLoadingPast(false);
    }, 500);
  }

  const handleOpenCancelDialog = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setIsCancelDialogOpen(true);
  };
  
  const handleShowQrCode = async (reservation: Reservation) => {
    if (!reservation.qrSecret || reservation.qrSecret.startsWith('USED_')) {
      toast({
        variant: 'destructive',
        title: '無法顯示 QR Code',
        description: '此預訂的 QR Code 不存在或已被使用。',
      });
      return;
    }
    setSelectedReservation(reservation);
    setIsLoadingQr(true);
    setIsQrDialogOpen(true);
    try {
      const dataUrl = await qrcode.toDataURL(reservation.qrSecret, {
        errorCorrectionLevel: 'H',
        margin: 2,
        scale: 8,
      });
      setQrCodeDataUrl(dataUrl);
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      toast({
        variant: 'destructive',
        title: 'QR Code 生成失敗',
        description: '無法為此預訂生成二維碼，請稍後再試。',
      });
      setIsQrDialogOpen(false);
    } finally {
      setIsLoadingQr(false);
    }
  };

  const handleCancelReservation = async () => {
    if (!selectedReservation) return;
    setIsSubmitting(true);

    const result = await cancelReservation(selectedReservation);

    if (result.success) {
      toast({
        title: "預訂已取消",
        description: `已成功為您取消預訂，並退回 HKD ${selectedReservation.costInTokens}。`,
      });
      fetchUserReservations();

      const userDataString = localStorage.getItem('user');
      if(userDataString) {
        try {
          const user: AppUser = JSON.parse(userDataString);
          user.tokens = (user.tokens ?? 0) + selectedReservation.costInTokens;
          localStorage.setItem('user', JSON.stringify(user));
          window.dispatchEvent(new Event('userUpdated'));
        } catch(e) {
            console.error("Failed to update user tokens in localStorage after cancellation refund.")
        }
      }
      
    } else {
      toast({
        variant: "destructive",
        title: "取消失敗",
        description: result.error || '發生未知錯誤，請稍後再試。',
      });
    }

    setIsSubmitting(false);
    setIsCancelDialogOpen(false);
  };

  const handleResendEmail = async (reservation: Reservation) => {
    const now = Date.now();
    if (resendCooldowns[reservation.id] && now < resendCooldowns[reservation.id]) {
      const timeLeft = Math.ceil((resendCooldowns[reservation.id] - now) / 1000 / 60);
      toast({
        variant: 'destructive',
        title: '操作過於頻繁',
        description: `請於大約 ${timeLeft} 分鐘後再試。`,
      });
      return;
    }
    
    setResendingEmailId(reservation.id);
    toast({
      title: '正在重新發送郵件...',
      description: '請稍候。'
    });
    
    const result = await resendConfirmationEmail(reservation.qrSecret);
    if (result.success) {
      toast({
        title: '電郵已成功發送',
        description: `已將包含 QR Code 的確認郵件重新發送到 ${reservation.userEmail}。`
      });
      const cooldownEnds = Date.now() + 5 * 60 * 1000;
      setResendCooldowns(prev => ({ ...prev, [reservation.id]: cooldownEnds }));

    } else {
      toast({
        variant: 'destructive',
        title: '郵件發送失敗',
        description: result.error || '發生未知錯誤，請聯絡管理員。'
      });
    }
    setResendingEmailId(null);
  };
  
  const canCancel = (reservation: Reservation) => {
    const now = new Date();
    const reservationStart = new Date(`${reservation.date}T${reservation.startTime}`);

    if (isAfter(now, reservationStart)) {
      return false;
    }
    
    if (currentUser?.role.toLowerCase() === 'admin') {
      return true;
    }

    const twelveHoursBefore = subHours(reservationStart, 12);
    return isBefore(now, twelveHoursBefore);
  };

  const ReservationCard = ({ res }: { res: ReservationWithStatus }) => {
    const { statusDisplay } = res;
    const isResending = resendingEmailId === res.id;
    const isOnCooldown = resendCooldowns[res.id] && Date.now() < resendCooldowns[res.id];
    
    return (
      <Card key={res.id}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
                <CardTitle className="text-xl flex items-center gap-2">
                  {res.roomName.replace('房間', '枱號')}
                  {res.isSoloPractice && (
                    <Badge variant="outline" className="text-green-700 border-green-500">
                      <Star className="mr-1 h-3 w-3" />
                      一人練波
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>預訂於：{format(parseISO(res.bookingDate), 'yyyy-MM-dd HH:mm')}</CardDescription>
            </div>
            <Badge variant="outline" className={`${statusDisplay.className} border-transparent font-semibold`}>{statusDisplay.text}</Badge>
        </CardHeader>
        <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span className="text-base font-semibold text-foreground">{res.date}</span>
                </div>
                <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span className="text-base font-semibold text-foreground">{res.startTime} - {res.endTime}</span>
                </div>
                <div className="flex items-center gap-2">
                    <CircleDollarSign className="h-4 w-4" />
                    <span>費用: <span className="font-semibold text-foreground">HKD ${res.costInTokens}</span></span>
                </div>
                <div className="flex items-center gap-2">
                    <Hash className="h-4 w-4" />
                    <span>REFERENCE: {res.id}</span>
                </div>
            </div>
             {res.status === 'Confirmed' && res.statusDisplay.sortOrder < 3 && res.qrSecret && (
              <div className="border-t mt-4 pt-4 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => handleShowQrCode(res)} disabled={isSubmitting || isResending}>
                    <QrCodeIcon className="mr-2 h-4 w-4" />
                    顯示入場二維碼
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleResendEmail(res)} disabled={isResending || isSubmitting || isOnCooldown}>
                    {isResending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Mail className="mr-2 h-4 w-4"/>}
                    {isOnCooldown ? `請於 ${Math.ceil((resendCooldowns[res.id] - Date.now()) / 60000)} 分鐘後再試` : '重發確認郵件'}
                </Button>
                {canCancel(res) && (
                  <Button variant="destructive" size="sm" onClick={() => handleOpenCancelDialog(res)} disabled={isSubmitting || isResending}>
                      <Ban className="mr-2 h-4 w-4"/>
                      取消預訂
                  </Button>
                )}
              </div>
            )}
        </CardContent>
      </Card>
    );
  };


  return (
    <>
      <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
        <div className="w-full max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>我的預訂</CardTitle>
                <CardDescription>您目前和過去的房間預訂列表。</CardDescription>
              </div>
            </CardHeader>
          </Card>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground mt-4">正在載入您的預訂...</p>
            </div>
          ) : error ? (
              <Card>
                  <CardContent className="pt-6">
                  <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed rounded-lg bg-destructive/10 text-destructive">
                      <Info className="h-8 w-8 mb-4" />
                      <p className="font-semibold">無法載入預訂</p>
                      <p className="text-sm">{error}</p>
                  </div>
                  </CardContent>
              </Card>
          ) : (
            <div className="space-y-4">
              {upcomingReservations.length > 0 ? (
                upcomingReservations.map(res => <ReservationCard key={res.id} res={res} />)
              ) : (
                <Card>
                    <CardContent className="pt-6">
                    <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg">
                        <Info className="h-8 w-8 text-muted-foreground mb-4" />
                        <p className="text-muted-foreground">您目前沒有任何生效中的預訂。</p>
                    </div>
                    </CardContent>
                </Card>
              )}
              
              <div className="space-y-4">
                {pastReservations.slice(0, visiblePastCount).map(res => <ReservationCard key={res.id} res={res} />)}
              </div>

              {pastReservations.length > 0 && visiblePastCount < pastReservations.length && (
                <Button variant="outline" className="w-full" onClick={handleLoadMorePast} disabled={isLoadingPast}>
                    {isLoadingPast ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <History className="mr-2 h-4 w-4" />
                    )}
                    載入過去的預訂
                </Button>
              )}
              
              {pastReservations.length === 0 && visiblePastCount === 0 && (
                 <Button variant="outline" className="w-full" onClick={handleLoadMorePast} disabled={isLoadingPast || pastReservations.length === 0}>
                    {isLoadingPast ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <History className="mr-2 h-4 w-4" />}
                    載入過去的預訂
                </Button>
              )}

            </div>
          )}
        </div>
      </main>

      <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要取消預訂嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作將會取消您的預訂，並將款項 <span className="font-bold text-primary">HKD ${selectedReservation?.costInTokens}</span> 全數退回到您的帳戶餘額中。此動作無法復原。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>返回</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelReservation} disabled={isSubmitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              確定取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>入場二維碼</DialogTitle>
            <DialogDescription>
              請在門口的掃描器上展示此 QR Code 以開啟門鎖。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-4">
            {isLoadingQr ? (
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
            ) : qrCodeDataUrl ? (
              <Image src={qrCodeDataUrl} alt="Reservation QR Code" width={256} height={256} />
            ) : (
              <p className="text-destructive">無法載入 QR Code。</p>
            )}
          </div>
          <DialogFooter>
             <DialogClose asChild>
                <Button type="button" variant="secondary">關閉</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getStatus(reservation: Reservation): ReservationWithStatus['statusDisplay'] {
  const now = new Date();
  
  if (reservation.status === 'Cancelled') {
    return { text: '已取消', className: 'bg-gray-500 text-white', sortOrder: 4 };
  }

  const reservationStartDateTime = new Date(`${reservation.date}T${reservation.startTime}`);
  let reservationEndDateTime = new Date(`${reservation.date}T${reservation.endTime}`);

  if (isBefore(reservationEndDateTime, reservationStartDateTime)) {
    reservationEndDateTime = addDays(reservationEndDateTime, 1);
  }

  const threeHoursFromNow = addHours(now, 3);

  if (isAfter(now, reservationStartDateTime) && isBefore(now, reservationEndDateTime)) {
    return { text: '進行中', className: 'bg-red-500 text-white animate-pulse', sortOrder: 0 };
  }

  if (isAfter(now, reservationEndDateTime)) {
    return { text: '已完成', className: 'bg-gray-200 text-gray-800', sortOrder: 3 };
  }

  if (isBefore(reservationStartDateTime, threeHoursFromNow)) {
    return { text: '即將開始', className: 'bg-red-200 text-red-800', sortOrder: 1 };
  }

  return { text: '未使用', className: 'bg-green-200 text-green-800', sortOrder: 2 };
}
