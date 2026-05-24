
'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  format,
  addDays,
  subDays,
  parseISO,
  isValid,
} from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { zhTW } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Loader2, Ban, Phone, Hash, User, Building2, RefreshCw, QrCode as QrCodeIcon, KeyRound } from 'lucide-react';
import Image from 'next/image';
import qrcode from 'qrcode';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import type { Reservation, TemporaryAccess } from '@/types';
import { cancelReservation, getAdminBookingsInitialData } from '@/app/admin/bookings/actions';
import { cancelTemporaryAccessCode } from '@/app/(main)/temporary-access/actions';
import { cn } from '@/lib/utils';
import { db, auth } from '@/lib/firebase';
import { getAdminSlotPeriodHkt, getHktBookingStartUtc } from '@/lib/hkt-temp-segment';
import { useAdminFirestoreSession } from '@/lib/use-admin-firestore-session';
import {
  getAdminDayWindow,
  HKT,
  isSameHktDay,
  reservationInAdminWindow,
  sortReservationsByStartDesc,
  tempAccessInAdminWindow,
  adminTempAccessQueryFromIso,
} from '@/lib/admin-bookings-query';


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

/** 日曆格共 48 個半小時格（00:00–23:30） */
const SLOTS_PER_DAY = 48;

function getHktAnchorDate(): Date {
  const ymd = formatInTimeZone(new Date(), HKT, 'yyyy-MM-dd');
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

export function BookingsCalendar({ initialReservations, initialTempAccess }: BookingsCalendarProps) {
  const { toast } = useToast();
  const firestoreSession = useAdminFirestoreSession();
  const permissionDeniedToastShownRef = useRef(false);
  const [currentDate, setCurrentDate] = useState(getHktAnchorDate);
  const [reservations, setReservations] = useState<Reservation[]>(initialReservations);
  const [tempAccesses, setTempAccesses] = useState<TemporaryAccess[]>(initialTempAccess);
  const [selectedEvent, setSelectedEvent] = useState<CombinedEvent | null>(null);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isQrDialogOpen, setIsQrDialogOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [isLoadingQr, setIsLoadingQr] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [listenerKey, setListenerKey] = useState(0);
  const manualRefreshRef = useRef(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const timeSlots = useMemo(() => Array.from({ length: 48 }, (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = (i % 2) * 30;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }), []);

  
  const events: CombinedEvent[] = useMemo(() => {
    const reservationEvents: CombinedEvent[] = reservations
      .filter(r => r.status !== 'Cancelled' && r.date && r.startTime && r.endTime)
      .flatMap(r => {
        try {
          const start = getHktBookingStartUtc(r.date, r.startTime);
          const end = getAdminSlotPeriodHkt(r.date, r.startTime, r.endTime).validUntil;
          if (!isValid(start) || !isValid(end)) return [];
          const isOvernight = !isSameHktDay(start, end);
          return [{ ...r, eventType: 'reservation' as const, start, end, isOvernight }];
        } catch {
          return [];
        }
      });

    const tempAccessEvents: CombinedEvent[] = tempAccesses
      .filter(t => t.status === 'active' && (t.validFrom || t.effectiveFrom) && (t.validUntil || t.calendarUntil))
      .flatMap(t => {
        try {
          const start = parseISO(t.effectiveFrom ?? t.validFrom);
          const end = parseISO(t.calendarUntil ?? t.validUntil);
          if (!isValid(start) || !isValid(end)) return [];
          const isOvernight = !isSameHktDay(start, end);
          return [{ ...t, eventType: 'temp-access' as const, start, end, isOvernight }];
        } catch {
          return [];
        }
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
      
      const eventStartsToday = isSameHktDay(event.start, day);
      const eventSpillsFromYesterday = event.isOvernight && isSameHktDay(event.end, day);

      return eventStartsToday || eventSpillsFromYesterday;
    });
  }, [events]);

  useEffect(() => {
    const user = firestoreSession.user;
    const isAdmin = firestoreSession.isAdmin;

    if (!firestoreSession.ready) {
      return;
    }

    if (!user || !isAdmin || !firestoreSession.uid || !firestoreSession.authTokenReady) {
      return;
    }

    const dayYmd = formatInTimeZone(currentDate, HKT, 'yyyy-MM-dd');
    const window = getAdminDayWindow(dayYmd);

    const logContext = {
      firebaseUid: firestoreSession.uid,
      firebaseEmail: firestoreSession.email,
      localRole: firestoreSession.localRole,
      dayYmd,
      queryDates: window.queryDates,
      windowStartMs: window.windowStartMs,
      windowEndMs: window.windowEndMs,
    };

    const reservationsQuery = query(
      collection(db, 'reservations'),
      where('date', 'in', [...window.queryDates]),
      limit(50),
    );

    const tempAccessQuery = query(
      collection(db, 'temporaryAccess'),
      where('validUntil', '>=', adminTempAccessQueryFromIso(window)),
      orderBy('validUntil', 'desc'),
      limit(50),
    );

    const applyTempAccessRows = (rows: TemporaryAccess[]) => {
      const activeInWindow = rows
        .filter((t) => t.status === 'active')
        .filter((t) => tempAccessInAdminWindow(t, window));
      setTempAccesses((prev) => {
        if (activeInWindow.length > 0) return activeInWindow;
        // 查詢有結果但皆不在視窗 → 當日確實無有效臨時碼
        if (rows.length > 0) return [];
        // 查詢為空時保留 SSR／上一輪資料，避免 limit 截斷誤清空
        return prev;
      });
    };

    const finishRefresh = () => {
      if (manualRefreshRef.current) {
        manualRefreshRef.current = false;
        setIsRefreshing(false);
        toastRef.current({ title: '同步完成', description: '日曆資料已更新。' });
      }
    };

    const handleSnapshotError = (
      collectionName: string,
      error: { code?: string; message?: string },
      title: string,
    ) => {
      const authUser = auth.currentUser;
      const stillAdmin =
        authUser &&
        firestoreSession.isAdmin &&
        firestoreSession.localRole?.toLowerCase() === 'admin';

      console.error(`[admin/bookings] ${collectionName} onSnapshot failed`, {
        ...logContext,
        collection: collectionName,
        code: error.code,
        message: error.message,
        authCurrentUid: authUser?.uid ?? null,
        authCurrentEmail: authUser?.email ?? null,
        stillAdmin,
        authTokenReady: firestoreSession.authTokenReady,
      });

      setIsRefreshing(false);
      manualRefreshRef.current = false;

      if (error.code === 'permission-denied') {
        if (!authUser || !stillAdmin) {
          console.warn(
            `[admin/bookings] permission-denied ignored (auth not ready or not admin): ${collectionName}`,
          );
          return;
        }
        if (collectionName === 'temporaryAccess') {
          console.warn(
            '[admin/bookings] temporaryAccess permission-denied; falling back to server fetch',
          );
          void getAdminBookingsInitialData(dayYmd).then((result) => {
            if (result.success && result.accessCodes) {
              applyTempAccessRows(result.accessCodes);
            }
          });
          return;
        }
      }

      if (permissionDeniedToastShownRef.current && error.code === 'permission-denied') {
        return;
      }
      if (error.code === 'permission-denied') {
        permissionDeniedToastShownRef.current = true;
      }

      toastRef.current({
        variant: 'destructive',
        title,
        description: error.message ?? '即時同步失敗',
      });
    };

    permissionDeniedToastShownRef.current = false;

    const unsubscribeReservations = onSnapshot(
      reservationsQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) => docSnap.data() as Reservation);
        const filtered = rows
          .filter((r) => reservationInAdminWindow(r, window))
          .sort(sortReservationsByStartDesc);
        setReservations(filtered);
        finishRefresh();
      },
      (error) => handleSnapshotError('reservations', error, '預訂即時同步失敗'),
    );

    const unsubscribeTempAccess = onSnapshot(
      tempAccessQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as TemporaryAccess;
          return { ...data, id: data.id ?? docSnap.id };
        });
        applyTempAccessRows(rows);
      },
      (error) => handleSnapshotError('temporaryAccess', error, '臨時碼即時同步失敗'),
    );

    return () => {
      unsubscribeReservations();
      unsubscribeTempAccess();
    };
  }, [
    currentDate,
    listenerKey,
    firestoreSession.ready,
    firestoreSession.user,
    firestoreSession.isAdmin,
    firestoreSession.uid,
    firestoreSession.authTokenReady,
    firestoreSession.localRole,
    firestoreSession.email,
  ]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    manualRefreshRef.current = true;
    toast({ title: '正在同步...', description: '正在重新連接即時監聽。' });
    setListenerKey((key) => key + 1);
  };
  
  const handleEventClick = (event: CombinedEvent) => setSelectedEvent(event);
  const handleCloseDetailDialog = () => !isSubmitting && setSelectedEvent(null);
  const handleOpenCancelDialog = () => selectedEvent && setIsCancelDialogOpen(true);

  const handleShowQrCode = async (event: CombinedEvent) => {
    const qrSecret = event.eventType === 'reservation' ? event.qrSecret : (event.sharedSecret ?? event.id);
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
    
    const isSpillOver = !isSameHktDay(event.start, currentDay);

    let startSlots: number;
    let endSlots: number;

    if (isSpillOver) {
      startSlots = 0;
      endSlots = timeToIndex(formatInTimeZone(event.end, HKT, 'HH:mm'));
    } else if (event.isOvernight && isSameHktDay(event.start, currentDay)) {
      // 今日開始、跨午夜結束（例如 23:00–00:00 須畫到日末 24:00，不可把 00:00 當 slot 0）
      startSlots = timeToIndex(formatInTimeZone(event.start, HKT, 'HH:mm'));
      endSlots = SLOTS_PER_DAY;
    } else {
      startSlots = timeToIndex(formatInTimeZone(event.start, HKT, 'HH:mm'));
      endSlots = timeToIndex(formatInTimeZone(event.end, HKT, 'HH:mm'));
      if (endSlots <= startSlots) {
        endSlots = SLOTS_PER_DAY;
      }
    }

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
