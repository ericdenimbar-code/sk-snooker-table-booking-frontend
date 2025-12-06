
'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  format,
  addDays,
  subDays,
  isSameDay,
  parse,
  startOfDay,
  parseISO
} from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2, Edit, Ban, Phone, Hash, User, Building2, RefreshCw, Star, Mail, QrCode as QrCodeIcon, KeyRound } from 'lucide-react';
import Image from 'next/image';
import qrcode from 'qrcode';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import type { Reservation, TemporaryAccess } from '@/types';
import { cancelReservation, resendConfirmationEmail } from '@/app/admin/bookings/actions';
import { cancelTemporaryAccessCode } from '@/app/(main)/temporary-access/actions';
import { getAllReservations, getAllTemporaryAccess } from '@/app/(main)/new-reservation/actions';
import { cn } from '@/lib/utils';


type CombinedEvent = (Reservation | TemporaryAccess) & {
  eventType: 'reservation' | 'temp-access';
  start: Date;
  end: Date;
  isOvernight: boolean;
};

type BookingsCalendarProps = {
  initialReservations: Reservation[];
  initialTempAccess: TemporaryAccess[];
};

const timeToIndex = (time: string): number => {
    if (!time) return 0;
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 2 + (minutes / 30);
};

export function BookingsCalendar({ initialReservations, initialTempAccess }: BookingsCalendarProps) {
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [reservations, setReservations] = useState<Reservation[]>(initialReservations);
  const [tempAccesses, setTempAccesses] = useState<TemporaryAccess[]>(initialTempAccess);
  const [selectedEvent, setSelectedEvent] = useState<CombinedEvent | null>(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [isLoadingQr, setIsLoadingQr] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const timeSlots = useMemo(() => Array.from({ length: 48 }, (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = (i % 2) * 30;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }), []);

  
  const events: CombinedEvent[] = useMemo(() => {
    const reservationEvents: CombinedEvent[] = reservations
      .filter(r => r.status !== 'Cancelled' && r.startTime && r.endTime)
      .map(r => {
        const start = parse(`${r.date} ${r.startTime}`, 'yyyy-MM-dd HH:mm', new Date());
        let end = parse(`${r.date} ${r.endTime}`, 'yyyy-MM-dd HH:mm', new Date());
        const isOvernight = end <= start;
        if (isOvernight) end = addDays(end, 1);
        return { ...r, eventType: 'reservation', start, end, isOvernight };
      });

    const tempAccessEvents: CombinedEvent[] = tempAccesses
      .filter(t => t.status === 'active')
      .map(t => {
        const start = parseISO(t.validFrom);
        const end = parseISO(t.validUntil);
        const isOvernight = !isSameDay(start, end);
        return { ...t, eventType: 'temp-access', start, end, isOvernight };
      });

    return [...reservationEvents, ...tempAccessEvents];
  }, [reservations, tempAccesses]);
  
  const displayedDays = useMemo(() => [currentDate], [currentDate]);

  const getEventsForDay = useCallback((day: Date, filter: 'room1' | 'room2' | 'door') => {
    
    return events.filter(event => {
      let isMatch = false;
      if (event.eventType === 'reservation') {
        if ((filter === 'room1' && event.roomId === '1') || (filter === 'room2' && event.roomId === '2')) {
          isMatch = true;
        }
      } else if (event.eventType === 'temp-access' && filter === 'door') {
        isMatch = true;
      }
      
      if (!isMatch) return false;
      
      const eventStartsToday = isSameDay(event.start, day);
      const eventSpillsFromYesterday = event.isOvernight && isSameDay(event.end, day);
      
      // This is the fix: also include events that start today AND are overnight
      return eventStartsToday || eventSpillsFromYesterday;
    });
  }, [events]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    toast({ title: '正在同步...', description: '正在從資料庫重新整理所有記錄。' });
    const [resResult, tempResult] = await Promise.all([getAllReservations(), getAllTemporaryAccess()]);
    
    if (resResult.success && resResult.reservations) {
        setReservations(resResult.reservations);
    } else {
        toast({ variant: 'destructive', title: '預訂同步失敗', description: resResult.error });
    }
    
    if (tempResult.success && tempResult.accessCodes) {
        setTempAccesses(tempResult.accessCodes);
    } else {
        toast({ variant: 'destructive', title: '臨時碼同步失敗', description: tempResult.error });
    }
    
    toast({ title: '同步完成', description: '日曆資料已更新。' });
    setIsRefreshing(false);
  };
  
  const handleEventClick = (event: CombinedEvent) => setSelectedEvent(event);
  const handleCloseDetailDialog = () => !isSubmitting && setSelectedEvent(null);
  const handleOpenCancelDialog = () => selectedEvent && setIsCancelDialogOpen(true);

  const handleShowQrCode = async (event: CombinedEvent) => {
    const qrSecret = event.eventType === 'reservation' ? event.qrSecret : event.id;
    if (!qrSecret || (event.eventType === 'reservation' && qrSecret.startsWith('USED_'))) {
        toast({ variant: 'destructive', title: '無法顯示', description: '此記錄的 QR Code 不存在或已被使用。' });
        return;
    }
    setIsQrDialogOpen(true);
    setIsLoadingQr(true);
    try {
        const dataUrl = await qrcode.toDataURL(qrSecret, { errorCorrectionLevel: 'H', margin: 2, scale: 8 });
        setQrCodeDataUrl(dataUrl);
    } catch (err) {
        toast({ variant: 'destructive', title: 'QR Code 生成失敗' });
        setIsQrDialogOpen(false);
    } finally {
        setIsLoadingQr(false);
    }
  };

  const handleCancellation = async (shouldRefund?: boolean) => {
    if (!selectedEvent) return;
    setIsSubmitting(true);

    if (selectedEvent.eventType === 'reservation') {
        const result = await cancelReservation(selectedEvent, shouldRefund);
        if (result.success) {
            const successMessage = shouldRefund 
                ? `已成功為 ${selectedEvent.userEmail} 退回 HKD ${selectedEvent.costInTokens}。`
                : `已成功取消預訂，未退回款項。`;
            toast({ title: "預訂已取消", description: successMessage });
            setReservations(prev => prev.map(res => res.id === selectedEvent.id ? { ...res, status: 'Cancelled' } : res));
        } else {
            toast({ variant: 'destructive', title: '取消失敗', description: result.error });
        }
    } else if (selectedEvent.eventType === 'temp-access') {
        const result = await cancelTemporaryAccessCode(selectedEvent.id, selectedEvent.userId);
        if (result.success) {
            toast({ title: '臨時碼已取消' });
            setTempAccesses(prev => prev.map(t => t.id === selectedEvent.id ? { ...t, status: 'cancelled' } : t));
        } else {
            toast({ variant: 'destructive', title: '取消失敗', description: result.error });
        }
    }
    
    setIsSubmitting(false);
    setIsCancelDialogOpen(false);
    setSelectedEvent(null);
  };

  return (
    <>
      <div className="flex flex-col h-full bg-card rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between p-2 sm:p-4 border-b shrink-0">
            <div className='flex items-center gap-2'>
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(subDays(currentDate, 1))}><ChevronLeft className="h-5 w-5" /></Button>
              <h2 className="text-lg sm:text-xl font-semibold text-center">{format(currentDate, 'yyyy 年 M 月 d 日', { locale: zhTW })}</h2>
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(addDays(currentDate, 1))}><ChevronRight className="h-5 w-5" /></Button>
            </div>
            <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              重新整理
            </Button>
        </div>
        
        <div className="flex flex-1 overflow-auto">
          <div className="w-16 shrink-0 bg-background">
              <div className="h-[45px] border-b border-r"></div>
              {timeSlots.map(time => (
                  <div key={time} className="h-6 text-right pr-2 text-xs text-muted-foreground border-b border-r flex items-center justify-end">
                      {time.endsWith(':00') ? time : ''}
                  </div>
              ))}
          </div>

          <div className="flex-1 flex flex-col overflow-x-hidden">
              <div className="grid grid-cols-3 sticky top-0 bg-background z-20 shrink-0">
                  <div className="text-center py-1 border-b border-r"><p className="font-semibold !mb-0">枱號 1</p><p className="text-xs text-muted-foreground !mb-0">{format(displayedDays[0], 'EEE d', { locale: zhTW })}</p></div>
                  <div className="text-center py-1 border-b border-r"><p className="font-semibold !mb-0">枱號 2</p><p className="text-xs text-muted-foreground !mb-0">{format(displayedDays[0], 'EEE d', { locale: zhTW })}</p></div>
                  <div className="text-center py-1 border-b border-r"><p className="font-semibold !mb-0">臨時進出</p><p className="text-xs text-muted-foreground !mb-0">{format(displayedDays[0], 'EEE d', { locale: zhTW })}</p></div>
              </div>

              <div className="grid grid-cols-3 flex-1 overflow-y-auto">
                  {/* Room 1 */}
                  <div className="relative col-span-1 border-r">
                     {timeSlots.map((_, i) => <div key={`r1-bg-${i}`} className="h-6 border-b"></div>)}
                     {getEventsForDay(displayedDays[0], 'room1').map(event => <EventButton key={event.id} event={event} currentDay={displayedDays[0]} onClick={handleEventClick} className="bg-primary hover:bg-primary/90" />)}
                  </div>
                  {/* Room 2 */}
                  <div className="relative col-span-1 border-r">
                     {timeSlots.map((_, i) => <div key={`r2-bg-${i}`} className="h-6 border-b"></div>)}
                     {getEventsForDay(displayedDays[0], 'room2').map(event => <EventButton key={event.id} event={event} currentDay={displayedDays[0]} onClick={handleEventClick} className="bg-accent-foreground hover:bg-accent-foreground/90" />)}
                  </div>
                   {/* Door Control */}
                  <div className="relative col-span-1">
                     {timeSlots.map((_, i) => <div key={`door-bg-${i}`} className="h-6 border-b"></div>)}
                     {getEventsForDay(displayedDays[0], 'door').map(event => <EventButton key={event.id} event={event} currentDay={displayedDays[0]} onClick={handleEventClick} className="bg-amber-600 hover:bg-amber-600/90" />)}
                  </div>
              </div>
          </div>
        </div>
      </div>
      
      <EventDetailDialog event={selectedEvent} open={!!selectedEvent} onOpenChange={handleCloseDetailDialog} onCancel={handleOpenCancelDialog} onShowQr={handleShowQrCode} />
      <CancellationDialog event={selectedEvent} open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen} isSubmitting={isSubmitting} onConfirm={handleCancellation} />
      <QrCodeDialog event={selectedEvent} open={isQrDialogOpen} onOpenChange={setIsQrDialogOpen} isLoading={isLoadingQr} qrCodeDataUrl={qrCodeDataUrl} />
    </>
  );
}

const EventButton = ({ event, currentDay, onClick, className }: { event: CombinedEvent, currentDay: Date, onClick: (e: CombinedEvent) => void, className?: string }) => {
    
    const isSpillOver = !isSameDay(event.start, currentDay);
    const dayStart = startOfDay(currentDay);

    const startTimeForCalc = isSpillOver ? dayStart : event.start;
    let endTimeForCalc = event.end;
    
    if (event.isOvernight && isSameDay(event.start, currentDay)) {
        endTimeForCalc = addDays(dayStart, 1);
    } else if (!isSameDay(event.end, currentDay)) {
        endTimeForCalc = addDays(dayStart, 1);
    }
    
    const startSlots = timeToIndex(format(startTimeForCalc, 'HH:mm'));
    const endSlots = timeToIndex(format(endTimeForCalc, 'HH:mm'));
    
    const durationInSlots = endSlots - startSlots;

    if (durationInSlots <= 0) return null;
    
    const top = `${startSlots * 1.5}rem`; // Each slot (30-min) is 1.5rem high
    const height = `${durationInSlots * 1.5}rem`;
    
    const userName = event.eventType === 'reservation' ? event.userName : event.userEmail.split('@')[0];
    const timeText = `${format(event.start, 'HH:mm')} - ${format(event.end, 'HH:mm')}`;
    
    return (
        <button
            onClick={() => onClick(event)}
            className={cn("absolute w-full text-left p-1 rounded-lg text-white text-xs leading-tight transition-colors z-10", className)}
            style={{ top, height }}
        >
            <p className="font-bold truncate">{userName}</p>
            <p className="truncate text-primary-foreground/80">{timeText}</p>
        </button>
    );
};

const EventDetailDialog = ({ event, open, onOpenChange, onCancel, onShowQr }: { event: CombinedEvent | null, open: boolean, onOpenChange: (open: boolean) => void, onCancel: () => void, onShowQr: (event: CombinedEvent) => void }) => {
  if (!event) return null;

  const isReservation = event.eventType === 'reservation';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isReservation ? '預訂詳情' : '臨時進出碼詳情'}</DialogTitle>
           <DialogDescription>{format(event.start, 'yyyy年MM月dd日 HH:mm')} - {format(event.end, 'HH:mm')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                <User className="h-5 w-5 text-muted-foreground self-start mt-1"/>
                <div><p className="text-sm text-muted-foreground">用戶</p><p className="font-semibold">{isReservation ? event.userName : event.userEmail}</p></div>
                
                {isReservation ? <>
                  <Building2 className="h-5 w-5 text-muted-foreground self-start mt-1"/>
                  <div><p className="text-sm text-muted-foreground">枱號</p><p className="font-semibold">{event.roomName.replace('房間', '枱號')}</p></div>
                  <Phone className="h-5 w-5 text-muted-foreground self-start mt-1"/>
                  <div><p className="text-sm text-muted-foreground">手機號碼</p><p className="font-semibold">{event.userPhone}</p></div>
                </> : <>
                  <KeyRound className="h-5 w-5 text-muted-foreground self-start mt-1"/>
                  <div><p className="text-sm text-muted-foreground">類型</p><p className="font-semibold">臨時進出碼</p></div>
                </>}

                <Hash className="h-5 w-5 text-muted-foreground self-start mt-1"/>
                <div><p className="text-sm text-muted-foreground">參考編號</p><p className="font-semibold">{event.id}</p></div>
            </div>

             <div className="border-t pt-4 mt-4 flex flex-wrap gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => onShowQr(event)}><QrCodeIcon className="mr-2 h-4 w-4" />QR Code</Button>
                <Button variant="destructive" size="sm" onClick={onCancel}>
                    <Ban className="mr-2 h-4 w-4"/>
                    {isReservation ? '取消預訂' : '取消此臨時碼'}
                </Button>
             </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">關閉</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const CancellationDialog = ({ event, open, onOpenChange, isSubmitting, onConfirm }: { event: CombinedEvent | null, open: boolean, onOpenChange: (open: boolean) => void, isSubmitting: boolean, onConfirm: (refund?: boolean) => void }) => {
  if (!event) return null;

  if (event.eventType === 'temp-access') {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>確定要取消此臨時進出碼嗎？</AlertDialogTitle>
                    <AlertDialogDescription>
                        您正要為使用者 <span className="font-semibold text-foreground">{event.userEmail}</span> 取消臨時進出碼。此動作無法復原。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>返回</AlertDialogCancel>
                    <Button variant="destructive" onClick={() => onConfirm()} disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}確定取消</Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定要取消此預訂嗎？</AlertDialogTitle>
          <AlertDialogDescription>
              <p>您正在為使用者 <span className="font-semibold text-foreground">{event.userEmail}</span> 取消預訂。</p>
              <p>時段：<span className="font-semibold text-foreground">{event.date} {event.startTime}-{event.endTime}</span>。</p>
              <p className="mt-2">費用為 <span className="font-semibold text-primary">HKD {event.costInTokens}</span>。請選擇是否退款。</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>返回</AlertDialogCancel>
          <Button variant="outline" onClick={() => onConfirm(false)} disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}取消但<strong className="mx-1">不</strong>退款</Button>
          <Button variant="destructive" onClick={() => onConfirm(true)} disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}取消並退款</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const QrCodeDialog = ({ event, open, onOpenChange, isLoading, qrCodeDataUrl }: { event: CombinedEvent | null, open: boolean, onOpenChange: (open: boolean) => void, isLoading: boolean, qrCodeDataUrl: string }) => {
  if (!event) return null;
  const title = event.eventType === 'reservation' ? `入場二維碼 (Ref: ${event.id})` : `臨時進出碼 (Ref: ${event.id})`;
  const description = `此為使用者 ${event.eventType === 'reservation' ? event.userName : event.userEmail} 的憑證。`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center p-4">
          {isLoading ? <Loader2 className="h-16 w-16 animate-spin text-primary" /> : qrCodeDataUrl ? <Image src={qrCodeDataUrl} alt="QR Code" width={256} height={256} /> : <p className="text-destructive">無法載入 QR Code。</p>}
        </div>
        <DialogFooter>
           <DialogClose asChild><Button type="button" variant="secondary">關閉</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
