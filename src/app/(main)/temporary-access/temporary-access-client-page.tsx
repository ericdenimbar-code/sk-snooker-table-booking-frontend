'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { format, setHours, setMinutes, isBefore, isSameDay } from 'date-fns';
import { Button } from '@/components/ui/button';
import { DateSelector } from '@/components/custom/date-selector';
import { useToast } from '@/hooks/use-toast';
import { Loader2, QrCode as QrCodeIcon, Ban, AlertTriangle, Info } from 'lucide-react';
import { createTemporaryAccessCode, getActiveTemporaryAccessCode, cancelTemporaryAccessCode } from './actions';
import Image from 'next/image';
import qrcode from 'qrcode';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { TemporaryAccess } from '@/types';
import type { User as AppUser } from '@/app/admin/users/actions';
import { cn } from '@/lib/utils';

type SelectedSlot = {
  date: Date;
  time: string;
};

export function TemporaryAccessClientPage() {
  const { toast } = useToast();
  
  const [user, setUser] = useState<AppUser | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<SelectedSlot[]>([]);
  
  const [activeCode, setActiveCode] = useState<TemporaryAccess | null>(null);
  const [activeQrCodeUrl, setActiveQrCodeUrl] = useState<string>('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  const isAdmin = useMemo(() => user?.role.toLowerCase() === 'admin', [user]);

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
  
  const fetchActiveCode = useCallback(async (currentUser: AppUser) => {
    setIsLoading(true);
    const result = await getActiveTemporaryAccessCode(currentUser.id);
    if (result.success && result.activeCode) {
      setActiveCode(result.activeCode);
      const url = await generateQrCodeDataUrl(result.activeCode.id);
      setActiveQrCodeUrl(url);
    } else {
      setActiveCode(null);
      setActiveQrCodeUrl('');
      if (!result.success && result.error) {
        toast({ variant: 'destructive', title: '檢查狀態失敗', description: result.error });
      }
    }
    setIsLoading(false);
  }, [generateQrCodeDataUrl, toast]);

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
    if (activeCode) {
      const validUntil = new Date(activeCode.validUntil).getTime();
      const now = Date.now();
      const timeout = validUntil - now;

      if (timeout > 0) {
        const timerId = setTimeout(() => {
          if (user) {
             fetchActiveCode(user); // Re-fetch to confirm expiry
          } else {
             setActiveCode(null);
             setActiveQrCodeUrl('');
          }
          toast({ title: '臨時碼已過期', description: '您可以申請新的臨時進出碼了。' });
        }, timeout);
        return () => clearTimeout(timerId);
      }
    }
  }, [activeCode, toast, user, fetchActiveCode]);


  const timeSlots = useMemo(() =>
    Array.from({ length: 48 }, (_, i) => {
      const hours = Math.floor(i / 2);
      const minutes = (i % 2) * 30;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }),
    []
  );

  const handleSlotClick = (time: string) => {
    if (!selectedDate) return;

    if (activeCode && !isAdmin) {
      setIsAlertOpen(true);
      return;
    }

    const [h, m] = time.split(':').map(Number);
    const slotDateTime = setMinutes(setHours(new Date(selectedDate), h), m);
    if (isBefore(slotDateTime, new Date())) {
        toast({ variant: 'destructive', title: '不能選擇過去的時段' });
        return;
    }

    const newSlot = { date: selectedDate, time };

    if (isAdmin) {
      if (selectedSlots.length === 1 && isSameDay(selectedSlots[0].date, newSlot.date)) {
        const startSlot = selectedSlots[0];
        const startIndex = timeSlots.indexOf(startSlot.time);
        const endIndex = timeSlots.indexOf(newSlot.time);
        const rangeStart = Math.min(startIndex, endIndex);
        const rangeEnd = Math.max(startIndex, endIndex);
        
        const newSelection: SelectedSlot[] = [];
        for (let i = rangeStart; i <= rangeEnd; i++) {
          newSelection.push({ date: selectedDate, time: timeSlots[i] });
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
        
        const result = await createTemporaryAccessCode({
            userId: user.id,
            userEmail: user.email,
            date: format(firstSlot.date, 'yyyy-MM-dd'),
            startTime: firstSlot.time,
            endTime: isAdmin ? getEndTime(lastSlot.time) : undefined,
        });

        if (result.success && result.newCode) {
            toast({ title: '臨時碼已生成' });
            setSelectedSlots([]);
            await fetchActiveCode(user);
        } else {
            throw new Error(result.error || '無法生成 QR Code。');
        }

    } catch (error: any) {
        toast({ variant: 'destructive', title: '生成失敗', description: error.message });
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
    } else {
      toast({ variant: 'destructive', title: '取消失敗', description: result.error });
    }
    setIsSubmitting(false);
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
    const isSelected = selectedSlots.some(s => s.time === time && isSameDay(s.date, selectedDate));
    const [h, m] = time.split(':').map(Number);
    const slotDateTime = setMinutes(setHours(new Date(selectedDate), h), m);
    const isPast = isBefore(slotDateTime, new Date());

    return (
      <Button
        key={time}
        variant={isSelected ? 'default' : 'outline'}
        onClick={() => handleSlotClick(time)}
        className="h-auto py-1.5 w-full"
        disabled={isPast}
      >
        <span className="font-normal">{time} - {getEndTime(time)}</span>
      </Button>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>您目前生效的臨時進出碼</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : activeCode ? (
            <>
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
      
      <div className={cn((activeCode && !isAdmin) && "hidden")}>
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
              {isAdmin ? '請點選開始及結束時段以選取一個範圍。' : `顯示 ${format(selectedDate, "yyyy年MM月dd日")} 的時段。`}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {timeSlots.map(time => renderSlotButton(time))}
            </div>
          </div>
        )}

        {selectedSlots.length > 0 && (
          <div className="border-t pt-6 mt-6">
            <Button onClick={handleGenerateQr} disabled={isSubmitting} size="lg" className="w-full">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCodeIcon className="mr-2 h-4 w-4" />}
              生成 {format(sortedSlots[0].date, 'yyyy-MM-dd')} {sortedSlots[0].time} 的臨時進出碼
            </Button>
          </div>
        )}
      </div>

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
