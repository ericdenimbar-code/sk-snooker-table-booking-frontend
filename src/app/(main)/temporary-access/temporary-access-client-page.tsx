'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { format, setHours, setMinutes, isBefore, isSameDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DateSelector } from '@/components/custom/date-selector';
import { useToast } from '@/hooks/use-toast';
import { Loader2, QrCode as QrCodeIcon, Ban, Info, Mail } from 'lucide-react';
import {
  createTemporaryAccessCode,
  getActiveTemporaryAccessCode,
  cancelTemporaryAccessCode,
  sendAdminTemporaryAccessQrEmail,
} from './actions';
import Image from 'next/image';
import qrcode from 'qrcode';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { TemporaryAccess } from '@/types';
import type { User as AppUser } from '@/app/admin/users/actions';
import { cn } from '@/lib/utils';

const HKT = 'Asia/Hong_Kong';

type SelectedSlot = {
  date: Date;
  time: string;
};

/** 僅 ADMIN：畫面上「目前生成」的預覽（與後台 getActive 無關） */
type AdminLocalPreview = {
  recordId: string;
  secret: string;
  rangeLabelHkt: string;
  qrDataUrl: string;
  requestedAtIso: string;
  validFromIso: string;
  validUntilIso: string;
};

function formatAdminRangeHkt(date: Date, firstHm: string, lastHm: string): string {
  const [y, mo, d] = format(date, 'yyyy-MM-dd').split('-').map(Number);
  const [h1] = firstHm.split(':').map(Number);
  const [h2] = lastHm.split(':').map(Number);
  const start = fromZonedTime(new Date(y, mo - 1, d, h1, 0, 0, 0), HKT);
  const endExclusive =
    h2 + 1 >= 24
      ? fromZonedTime(new Date(y, mo - 1, d + 1, 0, 0, 0, 0), HKT)
      : fromZonedTime(new Date(y, mo - 1, d, h2 + 1, 0, 0, 0), HKT);
  return `${formatInTimeZone(start, HKT, 'HH:mm')} - ${formatInTimeZone(endExclusive, HKT, 'HH:mm')}（香港時間 ${formatInTimeZone(start, HKT, 'yyyy-MM-dd')}）`;
}

function adminHourEndLabel(hourStart: string): string {
  const h = Number(hourStart.split(':')[0]);
  const e = (h + 1) % 24;
  return `${String(e).padStart(2, '0')}:00`;
}

function isAdminHourSlotPast(selectedDate: Date, hourStart: string): boolean {
  const [y, mo, d] = format(selectedDate, 'yyyy-MM-dd').split('-').map(Number);
  const h = Number(hourStart.split(':')[0]);
  const slotInst = fromZonedTime(new Date(y, mo - 1, d, h, 0, 0, 0), HKT);
  return slotInst.getTime() < Date.now();
}

export function TemporaryAccessClientPage() {
  const { toast } = useToast();

  const [user, setUser] = useState<AppUser | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<SelectedSlot[]>([]);

  const [activeCode, setActiveCode] = useState<TemporaryAccess | null>(null);
  const [activeQrCodeUrl, setActiveQrCodeUrl] = useState<string>('');

  const [adminPreview, setAdminPreview] = useState<AdminLocalPreview | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [visitorEmail, setVisitorEmail] = useState('');

  const isAdmin = useMemo(() => user?.role.toLowerCase() === 'admin', [user]);
  const isVvip = useMemo(() => user?.role.toLowerCase() === 'vvip', [user]);

  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    if (!activeCode || !isVvip) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeCode, isVvip]);

  const vvipSecondsLeft = useMemo(() => {
    if (!activeCode || !isVvip) return null;
    return Math.max(0, Math.floor((new Date(activeCode.validUntil).getTime() - nowTs) / 1000));
  }, [activeCode, isVvip, nowTs]);

  const formatCountdown = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const generateQrCodeDataUrl = useCallback(async (secret: string) => {
    if (!secret) return '';
    try {
      return await qrcode.toDataURL(secret, {
        errorCorrectionLevel: 'H',
        margin: 2,
        scale: 8,
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
      toast({ variant: 'destructive', title: 'QR Code 生成失敗' });
      return '';
    }
  }, [toast]);

  const fetchActiveCode = useCallback(
    async (currentUser: AppUser) => {
      setIsLoading(true);
      const result = await getActiveTemporaryAccessCode(currentUser.id);
      if (result.success && result.activeCode) {
        setActiveCode(result.activeCode);
        const secret = result.activeCode.sharedSecret ?? result.activeCode.id;
        const url = await generateQrCodeDataUrl(secret);
        setActiveQrCodeUrl(url);
      } else {
        setActiveCode(null);
        setActiveQrCodeUrl('');
        if (!result.success && result.error) {
          toast({ variant: 'destructive', title: '檢查狀態失敗', description: result.error });
        }
      }
      setIsLoading(false);
    },
    [generateQrCodeDataUrl, toast],
  );

  useEffect(() => {
    const initialize = async () => {
      const userDataString = localStorage.getItem('user');
      if (userDataString) {
        try {
          const parsedUser: AppUser = JSON.parse(userDataString);
          setUser(parsedUser);
          await fetchActiveCode(parsedUser);
        } catch (error) {
          console.error('Failed to initialize page:', error);
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    };
    initialize();
  }, [fetchActiveCode]);

  useEffect(() => {
    if (isVvip) return;
    if (activeCode) {
      const validUntil = new Date(activeCode.validUntil).getTime();
      const now = Date.now();
      const timeout = validUntil - now;

      if (timeout > 0) {
        const timerId = setTimeout(() => {
          if (user) {
            fetchActiveCode(user);
          } else {
            setActiveCode(null);
            setActiveQrCodeUrl('');
          }
          toast({
            title: '此臨時碼已過有效時間',
            description: '請先按下「取消此時段」，方可再次申請。',
          });
        }, timeout);
        return () => clearTimeout(timerId);
      }
    }
  }, [activeCode, toast, user, fetchActiveCode, isVvip]);

  const timeSlots = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => {
        const hours = Math.floor(i / 2);
        const minutes = (i % 2) * 30;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }),
    [],
  );

  const adminHourlySlots = useMemo(
    () => Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
    [],
  );

  const activeSlotList = isAdmin ? adminHourlySlots : timeSlots;

  const handleSlotClick = (time: string) => {
    if (!selectedDate) return;

    if (activeCode && !isAdmin) {
      setIsAlertOpen(true);
      return;
    }

    if (isAdmin) {
      if (isAdminHourSlotPast(selectedDate, time)) {
        toast({ variant: 'destructive', title: '不能選擇過去的時段' });
        return;
      }
    } else {
      const [h, m] = time.split(':').map(Number);
      const slotDateTime = setMinutes(setHours(new Date(selectedDate), h), m);
      if (isBefore(slotDateTime, new Date())) {
        toast({ variant: 'destructive', title: '不能選擇過去的時段' });
        return;
      }
    }

    const newSlot = { date: selectedDate, time };

    if (isAdmin) {
      if (selectedSlots.length === 1 && isSameDay(selectedSlots[0].date, newSlot.date)) {
        const startSlot = selectedSlots[0];
        const startIndex = adminHourlySlots.indexOf(startSlot.time);
        const endIndex = adminHourlySlots.indexOf(newSlot.time);
        const rangeStart = Math.min(startIndex, endIndex);
        const rangeEnd = Math.max(startIndex, endIndex);

        const newSelection: SelectedSlot[] = [];
        for (let i = rangeStart; i <= rangeEnd; i++) {
          newSelection.push({ date: selectedDate, time: adminHourlySlots[i] });
        }
        setSelectedSlots(newSelection);
      } else {
        setSelectedSlots([newSlot]);
      }
    } else {
      setSelectedSlots([newSlot]);
    }
  };

  const sortedSlots = useMemo(() => {
    return [...selectedSlots].sort((a, b) => {
      const dateTimeA = setMinutes(setHours(new Date(a.date), ...a.time.split(':').map(Number) as [number, number]));
      const dateTimeB = setMinutes(setHours(new Date(b.date), ...b.time.split(':').map(Number) as [number, number]));
      return dateTimeA.getTime() - dateTimeB.getTime();
    });
  }, [selectedSlots]);

  const handleVvipApply = async () => {
    if (!user || !isVvip) return;
    setIsSubmitting(true);
    try {
      const result = await createTemporaryAccessCode({
        userId: user.id,
        userEmail: user.email,
      });
      if (result.success && result.newCode) {
        toast({
          title: '臨時碼已生成',
          description: 'QR Code 已透過電郵發送至您的信箱。',
        });
        setNowTs(Date.now());
        await fetchActiveCode(user);
      } else {
        throw new Error(result.error || '無法生成 QR Code。');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '發生錯誤';
      toast({ variant: 'destructive', title: '生成失敗', description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGenerateQr = async () => {
    if (sortedSlots.length === 0 || !user) {
      toast({ variant: 'destructive', title: '錯誤', description: '請先選擇時段並確保您已登入。' });
      return;
    }

    if (activeCode && !isAdmin) {
      setIsAlertOpen(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const firstSlot = sortedSlots[0];
      const lastSlot = sortedSlots[sortedSlots.length - 1];

      if (isAdmin) {
        const rangeLabelHkt = formatAdminRangeHkt(firstSlot.date, firstSlot.time, lastSlot.time);
        const lastHour = Number(lastSlot.time.split(':')[0]);
        const endTime =
          lastHour + 1 >= 24 ? '00:00' : `${String(lastHour + 1).padStart(2, '0')}:00`;

        const result = await createTemporaryAccessCode({
          userId: user.id,
          userEmail: user.email,
          date: format(firstSlot.date, 'yyyy-MM-dd'),
          startTime: firstSlot.time,
          endTime,
          recipientEmail: visitorEmail.trim() ? visitorEmail.trim() : undefined,
          displayRangeHkt: rangeLabelHkt,
        });

        if (result.success && result.newCode) {
          const secret = result.newCode.sharedSecret ?? result.newCode.id;
          const qrDataUrl = await generateQrCodeDataUrl(secret);
          setAdminPreview({
            recordId: result.newCode.id,
            secret,
            rangeLabelHkt,
            qrDataUrl,
            requestedAtIso: result.newCode.requestedAt ?? result.newCode.createdAt ?? new Date().toISOString(),
            validFromIso: result.newCode.validFrom,
            validUntilIso: result.newCode.validUntil,
          });
          setSelectedSlots([]);
          toast({
            title: '臨時碼已生成',
            description: '已寫入 Firestore 並同步日曆；未自動發送電郵，請使用「按此以 Email 送出 QR Code」。',
          });
        } else {
          throw new Error(result.error || '無法生成 QR Code。');
        }
      } else {
        const result = await createTemporaryAccessCode({
          userId: user.id,
          userEmail: user.email,
          date: format(firstSlot.date, 'yyyy-MM-dd'),
          startTime: firstSlot.time,
          endTime: undefined,
          recipientEmail: undefined,
        });

        if (result.success && result.newCode) {
          toast({
            title: '臨時碼已生成',
            description: 'QR Code 已透過電郵發送至您的信箱。',
          });
          setSelectedSlots([]);
          setVisitorEmail('');
          await fetchActiveCode(user);
        } else {
          throw new Error(result.error || '無法生成 QR Code。');
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '發生錯誤';
      toast({ variant: 'destructive', title: '生成失敗', description: message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelCode = async () => {
    if (!activeCode || !user) return;
    setIsSubmitting(true);
    const result = await cancelTemporaryAccessCode(activeCode.id, user.id);
    if (result.success) {
      toast({ title: '臨時碼已取消' });
      setActiveCode(null);
      setActiveQrCodeUrl('');
      setNowTs(Date.now());
    } else {
      toast({ variant: 'destructive', title: '取消失敗', description: result.error });
    }
    setIsSubmitting(false);
  };

  const handleCancelAdminPreview = async () => {
    if (!adminPreview || !user) return;
    setIsSubmitting(true);
    const result = await cancelTemporaryAccessCode(adminPreview.recordId, user.id);
    if (result.success) {
      toast({ title: '已取消此臨時碼' });
      setAdminPreview(null);
    } else {
      toast({ variant: 'destructive', title: '取消失敗', description: result.error });
    }
    setIsSubmitting(false);
  };

  const handleAdminSendEmail = async () => {
    if (!user || !isAdmin || !adminPreview) {
      toast({ variant: 'destructive', title: '請先產生 QR Code' });
      return;
    }
    setIsSendingEmail(true);
    try {
      const res = await sendAdminTemporaryAccessQrEmail({
        userId: user.id,
        userEmail: user.email,
        recipientEmail: visitorEmail.trim() || undefined,
        qrSecret: adminPreview.secret,
        requestedAtIso: adminPreview.requestedAtIso,
      });
      if (res.success) {
        toast({ title: '電郵已送出', description: visitorEmail.trim() ? `已寄至 ${visitorEmail.trim()}` : '已寄至您的帳戶電郵' });
      } else {
        throw new Error(res.error || '發送失敗');
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '發送失敗';
      toast({ variant: 'destructive', title: '發送失敗', description: message });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const getEndTime = (startTime: string) => {
    if (!startTime) return '';
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + 30, 0, 0);
    return format(date, 'HH:mm');
  };

  const renderSlotButton = (time: string) => {
    if (!selectedDate) return null;
    const isSelected = selectedSlots.some((s) => s.time === time && isSameDay(s.date, selectedDate));
    const isPast = isAdmin
      ? isAdminHourSlotPast(selectedDate, time)
      : (() => {
          const [h, m] = time.split(':').map(Number);
          const slotDateTime = setMinutes(setHours(new Date(selectedDate), h), m);
          return isBefore(slotDateTime, new Date());
        })();

    return (
      <Button
        key={time}
        variant={isSelected ? 'default' : 'outline'}
        onClick={() => handleSlotClick(time)}
        className="h-auto py-1.5 w-full"
        disabled={isPast}
      >
        <span className="font-normal">
          {isAdmin ? `${time} - ${adminHourEndLabel(time)}` : `${time} - ${getEndTime(time)}`}
        </span>
      </Button>
    );
  };

  return (
    <div className="space-y-6">
      {isVvip ? (
        <Card>
          <CardHeader>
            <CardTitle>臨時進出碼</CardTitle>
            <CardDescription className="sr-only">VVIP 一鍵申請，有效 30 分鐘</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : activeCode ? (
              <>
                {vvipSecondsLeft !== null && vvipSecondsLeft > 0 && (
                  <p className="text-lg font-semibold tabular-nums">
                    剩餘有效時間：<span className="text-primary">{formatCountdown(vvipSecondsLeft)}</span>
                  </p>
                )}
                {vvipSecondsLeft === 0 && (
                  <p className="text-sm text-amber-700 dark:text-amber-500">
                    有效時間已結束，請先按下「取消此時段」後再申請。
                  </p>
                )}
                <div className="flex items-center justify-center p-4">
                  {activeQrCodeUrl ? (
                    <Image src={activeQrCodeUrl} alt="Temporary Access QR Code" width={200} height={200} />
                  ) : (
                    <Loader2 className="h-16 w-16 animate-spin text-primary" />
                  )}
                </div>
                <Button onClick={handleCancelCode} disabled={isSubmitting} variant="destructive" className="w-full">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                  取消此時段
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-6">
                <Button onClick={handleVvipApply} disabled={isSubmitting} size="lg" className="min-w-[200px]">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCodeIcon className="mr-2 h-4 w-4" />}
                  申請臨時進出碼
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>您目前生效的臨時進出碼</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              {isAdmin ? (
                <>
                  {isLoading ? (
                    <div className="flex items-center justify-center h-48">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  ) : adminPreview ? (
                    <>
                      <div className="border p-4 rounded-md bg-muted/50 space-y-1">
                        <p className="text-sm text-muted-foreground">香港時間</p>
                        <p className="text-xl font-bold tabular-nums">{adminPreview.rangeLabelHkt}</p>
                      </div>
                      <div className="flex items-center justify-center p-4">
                        {adminPreview.qrDataUrl ? (
                          <Image src={adminPreview.qrDataUrl} alt="Temporary Access QR Code" width={200} height={200} />
                        ) : (
                          <Loader2 className="h-16 w-16 animate-spin text-primary" />
                        )}
                      </div>
                      <Button onClick={handleCancelAdminPreview} disabled={isSubmitting} variant="destructive" className="w-full">
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                        取消此時段
                      </Button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground border-2 border-dashed rounded-md">
                      <Info className="h-8 w-8 mb-2" />
                      <p>請於下方選擇時段並按「生成」</p>
                      <p className="text-sm">產生後將顯示於此（不會自動發送電郵）</p>
                    </div>
                  )}
                </>
              ) : isLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : activeCode ? (
                <>
                  {Date.now() > new Date(activeCode.validUntil).getTime() && (
                    <p className="text-sm text-amber-700 dark:text-amber-500">
                      此申請已超過有效時間，請先取消後再重新申請。
                    </p>
                  )}
                  <div className="border p-4 rounded-md bg-muted/50 space-y-1">
                    <p className="font-semibold">{format(new Date(activeCode.validFrom), 'yyyy年MM月dd日')}</p>
                    <p className="text-2xl font-bold">
                      {format(new Date(activeCode.validFrom), 'HH:mm')} - {format(new Date(activeCode.validUntil), 'HH:mm')}
                    </p>
                  </div>
                  <div className="flex items-center justify-center p-4">
                    {activeQrCodeUrl ? (
                      <Image src={activeQrCodeUrl} alt="Temporary Access QR Code" width={200} height={200} />
                    ) : (
                      <Loader2 className="h-16 w-16 animate-spin text-primary" />
                    )}
                  </div>
                  <Button onClick={handleCancelCode} disabled={isSubmitting} variant="destructive" className="w-full">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                    取消此時段
                  </Button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground border-2 border-dashed rounded-md">
                  <Info className="h-8 w-8 mb-2" />
                  <p>未有申請任何入場碼</p>
                  <p className="text-sm">可點擊下方日曆申請</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className={cn((activeCode && !isAdmin) && 'hidden')}>
            {isAdmin && (
              <div className="mb-6 rounded-md border bg-muted/30 p-4 space-y-3">
                <Label htmlFor="visitor-email">訪客收件電郵（選填）</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="visitor-email"
                    type="email"
                    placeholder="留空則發送至您的帳戶電郵"
                    value={visitorEmail}
                    onChange={(e) => setVisitorEmail(e.target.value)}
                    className="max-w-md flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isSendingEmail || !adminPreview}
                    onClick={() => void handleAdminSendEmail()}
                    className="shrink-0"
                  >
                    {isSendingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                    按此以 Email 送出 QR Code
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  僅在按下上列按鈕時發送；收件人留空則寄至目前登入管理員電郵。產生 QR 時不會自動發信。
                </p>
              </div>
            )}
            <div>
              <h3 className="text-lg font-medium mb-2">1. 選擇日期</h3>
              <DateSelector
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    if (activeCode && !isAdmin) {
                      setIsAlertOpen(true);
                      return;
                    }
                    setSelectedDate(date);
                    setSelectedSlots([]);
                  }
                }}
              />
            </div>

            {selectedDate && (
              <div>
                <h3 className="text-lg font-medium mb-2 mt-6">2. 選擇時段</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {isAdmin
                    ? '請點選開始及結束「整點」時段以選取範圍（香港時間）。按下生成後會寫入資料庫與日曆，不會自動發信。'
                    : `顯示 ${format(selectedDate, 'yyyy年MM月dd日')} 的時段（香港時間）；每次申請有效 30 分鐘。`}
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{activeSlotList.map((time) => renderSlotButton(time))}</div>
              </div>
            )}

            {selectedSlots.length > 0 && (
              <div className="border-t pt-6 mt-6">
                <Button onClick={() => void handleGenerateQr()} disabled={isSubmitting} size="lg" className="w-full">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCodeIcon className="mr-2 h-4 w-4" />}
                  生成 {format(sortedSlots[0].date, 'yyyy-MM-dd')} {sortedSlots[0].time} 的臨時進出碼
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>無法申請新時段</AlertDialogTitle>
            <AlertDialogDescription>
              每人只能申請一個時段的進出碼，請等待時段完結後，或按下“取消”先取消之前的時段，才能重新申請你想要的時段。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setIsAlertOpen(false)}>明白</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
