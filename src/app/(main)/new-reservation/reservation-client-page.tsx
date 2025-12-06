
'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { addDays, format, startOfToday, setHours, setMinutes, isBefore, isSameDay, subDays, eachDayOfInterval, differenceInDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DateSelector } from '@/components/custom/date-selector';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ConfirmationDialog, type ConfirmationDetails } from '@/components/custom/confirmation-dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShoppingCart, ArrowRight } from 'lucide-react';
import type { RoomSettings } from '@/app/admin/settings/actions';
import type { Reservation } from '@/types';
import { adjustUserTokens, getUserByEmail } from '@/app/admin/users/actions';
import { createReservation, getReservationsForDateRange } from './actions';
import { useCart, type CartItem } from '@/hooks/use-cart';
import { useRouter } from 'next/navigation';


type SelectedSlot = {
  date: Date;
  time: string;
};

type AppUser = {
  id: string; 
  name: string;
  email:string;
  phone?: string;
  role: 'admin' | 'user' | 'Admin' | 'User' | 'VIP' | 'VVIP';
  tokens?: number;
};

type ReservationClientPageProps = {
    settings: RoomSettings;
    room1Name: string;
    room2Name: string;
    initialReservations: Reservation[]; // This will now be empty from the server
}

export function ReservationClientPage({ settings, room1Name, room2Name, initialReservations }: ReservationClientPageProps) {
  const { toast } = useToast();
  const router = useRouter();
  const { cart, addToCart } = useCart();
  
  const { newReservationPage, slotCostsData, termsAndConditions } = settings;
  const { title, description, pricingTiers } = newReservationPage;

  const [user, setUser] = useState<AppUser | null>(null);
  const [allReservations, setAllReservations] = useState<Reservation[]>(initialReservations);
  const [availability, setAvailability] = useState<Map<string, number>>(new Map());

  const slotCostMap = useMemo(() => new Map(slotCostsData.map(s => [s.startTime, s.cost])), [slotCostsData]);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedSlots, setSelectedSlots] = useState<SelectedSlot[]>([]);
  
  const [isMounted, setIsMounted] = useState(false);
  const slotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const confirmationPanelRef = useRef<HTMLDivElement>(null);
  const [isConflictDialogOpen, setIsConflictDialogOpen] = useState(false);
  const [isDurationErrorDialogOpen, setIsDurationErrorDialogOpen] = useState(false);
  
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isSoloBooking, setIsSoloBooking] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    
    const updateUserState = async () => {
        const userDataString = localStorage.getItem('user');
        if (userDataString) {
            try {
                const parsedUser: AppUser = JSON.parse(userDataString);
                const latestUser = await getUserByEmail(parsedUser.email);
                if (latestUser) {
                  setUser(latestUser);
                  localStorage.setItem('user', JSON.stringify(latestUser));
                } else {
                  setUser(parsedUser);
                }
            } catch (error) {
                console.error('Failed to parse or fetch user data:', error);
            }
        }
    };

    updateUserState();
    window.addEventListener('userUpdated', updateUserState);
    return () => window.removeEventListener('userUpdated', updateUserState);
  }, []);

  useEffect(() => {
    if (!selectedDate) return;

    const fetchReservations = async () => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const result = await getReservationsForDateRange(dateStr);
        if (result.success && result.reservations) {
            setAllReservations(result.reservations);
        } else {
            console.error("Failed to fetch reservations:", result.error);
            toast({
                variant: 'destructive',
                title: '讀取預訂失敗',
                description: '無法獲取最新的預訂狀態，請稍後再試。'
            });
        }
    };
    
    fetchReservations();
    
    const intervalId = setInterval(fetchReservations, 60000);

    return () => clearInterval(intervalId);
  }, [selectedDate, toast]);


  const timeSlots = useMemo(() =>
    Array.from({ length: 48 }, (_, i) => {
      const hours = Math.floor(i / 2);
      const minutes = (i % 2) * 30;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }),
    []
  );

  useEffect(() => {
    if (!selectedDate) return;

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const newAvailability = new Map<string, number>();

    const reservationsOnDate = allReservations.filter(res => 
        res.status !== 'Cancelled' &&
        (res.date === dateStr || (res.endTime < res.startTime && res.date === format(subDays(selectedDate, 1), 'yyyy-MM-dd')))
    );
    
    timeSlots.forEach(time => {
        const bookingsInSlot = reservationsOnDate.filter(res => {
            const startTimeIndex = timeSlots.indexOf(res.startTime);
            const endTimeIndex = timeSlots.indexOf(res.endTime);
            const currentTimeIndex = timeSlots.indexOf(time);

            if (endTimeIndex > startTimeIndex) {
                return res.date === dateStr && currentTimeIndex >= startTimeIndex && currentTimeIndex < endTimeIndex;
            }
            else if (endTimeIndex < startTimeIndex) {
                if (res.date === format(subDays(selectedDate, 1), 'yyyy-MM-dd')) {
                    return currentTimeIndex < endTimeIndex;
                }
                if (res.date === dateStr) {
                    return currentTimeIndex >= startTimeIndex;
                }
            }
            return false;
        });
        newAvailability.set(time, bookingsInSlot.length);
    });

    setAvailability(newAvailability);
}, [selectedDate, allReservations, timeSlots]);


  const handleSlotClick = (time: string) => {
    if (!selectedDate || !isMounted) return;

    const [hours, minutes] = time.split(':').map(Number);
    const slotDateTime = setMinutes(setHours(new Date(selectedDate), hours), minutes);

    const slotAvailability = availability.get(time) || 0;
    if (slotAvailability >= 2 || isBefore(slotDateTime, new Date())) {
      return;
    }

    const newSlot = { date: selectedDate, time };

    if (selectedSlots.length === 1) {
        let startSlot = selectedSlots[0];
        let endSlot = newSlot;
        
        const startDateTime = setMinutes(setHours(new Date(startSlot.date), ...startSlot.time.split(':').map(Number) as [number, number]));
        const endDateTime = setMinutes(setHours(new Date(endSlot.date), ...endSlot.time.split(':').map(Number) as [number, number]));

        // Ensure start is before end, swapping if necessary
        if (startDateTime > endDateTime) {
            [startSlot, endSlot] = [endSlot, startSlot];
        }

        const newSelection: SelectedSlot[] = [];
        let hasConflict = false;

        const days = eachDayOfInterval({
            start: startSlot.date,
            end: endSlot.date,
        });
        
        // This calculates the number of 30-min slots. For a 2-day selection, it could be large.
        const durationDays = differenceInDays(endSlot.date, startSlot.date);
        const startIndex = timeSlots.indexOf(startSlot.time);
        const endIndex = timeSlots.indexOf(endSlot.time);
        const totalSlots = (durationDays * 48) + (endIndex - startIndex);

        if (totalSlots > 96) { // Limit selection to a reasonable range, e.g., 48 hours
            setIsConflictDialogOpen(true); // Or a new dialog for "selection too large"
            setSelectedSlots([]);
            return;
        }

        for (const day of days) {
            const isStartDay = isSameDay(day, startSlot.date);
            const isEndDay = isSameDay(day, endSlot.date);
            
            const dayStartTime = isStartDay ? startSlot.time : '00:00';
            const dayEndTime = isEndDay ? endSlot.time : '23:30';

            const dayStartIndex = timeSlots.indexOf(dayStartTime);
            const dayEndIndex = timeSlots.indexOf(dayEndTime);
            
            for (let i = dayStartIndex; i <= dayEndIndex; i++) {
                const currentSlotTime = timeSlots[i];
                const [h, m] = currentSlotTime.split(':').map(Number);
                const currentSlotDateTime = setMinutes(setHours(new Date(day), h), m);

                const currentSlotAvailability = availability.get(currentSlotTime) || 0;
                if (currentSlotAvailability >= 2 || isBefore(currentSlotDateTime, new Date())) {
                    hasConflict = true;
                    break;
                }
                newSelection.push({ date: day, time: currentSlotTime });
            }
            if (hasConflict) break;
        }

        if (hasConflict) {
            setIsConflictDialogOpen(true);
            setSelectedSlots([]);
        } else {
            setSelectedSlots(newSelection);
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
  
  const totalCost = useMemo(() => {
    return sortedSlots.reduce((total, slot) => {
      return total + (slotCostMap.get(slot.time) || 0);
    }, 0);
  }, [sortedSlots, slotCostMap]);
  
  const soloPracticeDiscount = useMemo(() => {
    if (sortedSlots.length === 0) return 0;
    return sortedSlots.length * 15;
  }, [sortedSlots]);

  const bookingCost = useMemo(() => {
    const isPrivileged = user && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin');
    const privilegedCost = isPrivileged ? Math.floor(totalCost * 0.85) : totalCost;
    
    if (isSoloBooking) {
        const soloCost = totalCost - soloPracticeDiscount;
        return Math.max(Math.min(privilegedCost, soloCost), 0);
    }

    return Math.max(privilegedCost, 0);
  }, [isSoloBooking, totalCost, soloPracticeDiscount, user]);


  const handleImmediateBooking = () => {
    const isAdmin = user?.role?.toLowerCase() === 'admin';
    if (!isAdmin && sortedSlots.length < 2) {
      setIsDurationErrorDialogOpen(true);
      return;
    }

    if (!user) {
        toast({
            variant: 'destructive',
            title: '請先登入',
            description: '您需要登入才能進行預約。',
        });
        return;
    }
    
    // Admin bypasses the balance check
    if (!isAdmin && (user.tokens ?? 0) < bookingCost) {
      toast({
        variant: 'destructive',
        title: '餘額不足',
        description: `您需要 HKD ${bookingCost.toFixed(2)} 來完成此預約，但您目前只有 HKD ${user?.tokens?.toFixed(2) ?? 0}。`,
      });
      return;
    }

    setIsConfirmationOpen(true);
  };
  
  const handleAddToCart = () => {
    const isAdmin = user?.role?.toLowerCase() === 'admin';
    if (!isAdmin && sortedSlots.length < 2) {
      setIsDurationErrorDialogOpen(true);
      return false; // Return false on failure
    }

    // New validation logic before adding to cart
    const assignedRoom = determineRoomForBooking(sortedSlots, true);
    if (!assignedRoom) {
      toast({ variant: 'destructive', title: '加入失敗', description: '無法找到可用的球枱，可能在您選擇時已被他人預訂或購物車已滿。' });
      return false; // Return false on failure
    }
    
    const newCartItem: CartItem = {
      id: `${Date.now()}`,
      date: format(sortedSlots[0].date, 'yyyy-MM-dd'),
      startTime: sortedSlots[0].time,
      endTime: getEndTime(sortedSlots[sortedSlots.length - 1].time),
      duration: sortedSlots.length * 0.5,
      cost: bookingCost,
      roomName: assignedRoom.roomName,
      roomId: assignedRoom.roomId,
      isSolo: isSoloBooking,
      originalCost: totalCost,
      isVip: user !== null && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin'),
    };

    addToCart(newCartItem);

    toast({
      title: '已加入購物車',
      description: `${newCartItem.roomName.replace('房間', '枱號')} ${newCartItem.date} ${newCartItem.startTime} 的預約已加入。`,
    });

    // Reset selection
    setSelectedSlots([]);
    setIsSoloBooking(false);
    return true; // Return true on success
  };

  const handleAddToCartAndCheckout = () => {
    // First, try to add the current selection to the cart.
    const wasAdded = handleAddToCart();
    // If the item was successfully added (or if there was nothing to add), proceed to cart.
    if (wasAdded) {
      router.push('/cart');
    }
    // If handleAddToCart returned false, it means there was an error (e.g., conflict, duration),
    // and the toast message would have already been shown. We do nothing further.
  };

  const determineRoomForBooking = useCallback((slots: SelectedSlot[], isAddingToCart: boolean = false): { roomId: string, roomName: string } | null => {
      if (slots.length === 0) return null;

      const isSlotBookedInRoom = (date: Date, time: string, roomId: string) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        // Check reservations from server
        const serverConflict = allReservations.some(res => {
          if (res.roomId !== roomId || res.status === 'Cancelled') return false;

          const startTimeIndex = timeSlots.indexOf(res.startTime);
          const endTimeIndex = timeSlots.indexOf(res.endTime);
          const currentTimeIndex = timeSlots.indexOf(time);

          if (endTimeIndex > startTimeIndex) {
              return res.date === dateStr && currentTimeIndex >= startTimeIndex && currentTimeIndex < endTimeIndex;
          } else {
              const resDate = format(subDays(date, 1), 'yyyy-MM-dd');
              if (res.date === resDate && currentTimeIndex < endTimeIndex) return true;
              if (res.date === dateStr && currentTimeIndex >= startTimeIndex) return true;
          }
          return false;
        });

        if (serverConflict) return true;

        // Check items already in cart for the same slot
        const cartConflict = cart.some(item => 
            item.roomId === roomId &&
            item.date === dateStr &&
            time >= item.startTime &&
            time < item.endTime
        );
        
        return cartConflict;
      };
      
      const isRoom1Free = slots.every(slot => !isSlotBookedInRoom(slot.date, slot.time, '1'));
      if (isRoom1Free) {
        return { roomId: '1', roomName: room1Name };
      }

      const isRoom2Free = slots.every(slot => !isSlotBookedInRoom(slot.date, slot.time, '2'));
      if (isRoom2Free) {
        return { roomId: '2', roomName: room2Name };
      }
      
      return null;

  }, [allReservations, cart, timeSlots, room1Name, room2Name]);
  
  const processTokenPayment = async (details: ConfirmationDetails) => {
    setIsSubmitting(true);
    const isAdmin = user?.role?.toLowerCase() === 'admin';

    if (sortedSlots.length === 0 || !user || !user.id) {
      toast({ variant: 'destructive', title: '預約失敗', description: `無法獲取有效的使用者 ID。請重新登入後再試。` });
      setIsSubmitting(false);
      return;
    };

    if (!isAdmin && (user.tokens === undefined || user.tokens < details.finalCost)) {
      toast({ variant: 'destructive', title: '餘額不足', description: `此預約需要 HKD ${details.finalCost.toFixed(2)}，但您目前只有 HKD ${user.tokens.toFixed(2)}。` });
      setIsSubmitting(false);
      return;
    }
    
    const assignedRoom = determineRoomForBooking(sortedSlots);
    if (!assignedRoom) {
      toast({ variant: 'destructive', title: '預約失敗', description: '無法找到可用的球枱，可能在您選擇時已被他人預訂。請重新整理頁面再試。' });
      setIsSubmitting(false);
      return;
    }

    if (!isAdmin) {
      const tokenResult = await adjustUserTokens(user.id, -details.finalCost);
      if (!tokenResult.success) {
        toast({ variant: 'destructive', title: '預約失敗', description: tokenResult.error || '無法與後端同步餘額，預約已取消。'});
        setIsSubmitting(false);
        return;
      }
    }

    const firstSlot = sortedSlots[0];
    const dateStr = format(firstSlot.date, 'yyyy-MM-dd');
    const startTime = firstSlot.time;
    const endTime = getEndTime(sortedSlots[sortedSlots.length - 1].time);
    const hours = sortedSlots.length * 0.5;

    const newReservationData: Omit<Reservation, 'id' | 'bookingDate' | 'qrSecret'> = {
      roomId: assignedRoom.roomId,
      roomName: assignedRoom.roomName,
      userName: user.name,
      userEmail: user.email,
      userPhone: user.phone || '',
      date: dateStr,
      startTime,
      endTime,
      hours: hours,
      costInTokens: isAdmin ? 0 : details.finalCost, // Admin bookings cost 0
      isSoloPractice: details.isSolo,
      status: 'Confirmed',
      paymentMethod: 'tokens',
    };

    const reservationResult = await createReservation(newReservationData);
    
    if (!reservationResult.success || !reservationResult.newReservation) {
      toast({ variant: 'destructive', title: '儲存預約失敗', description: reservationResult.error || '無法將預約儲存至資料庫。' });
      // Rollback token deduction if it happened
      if (!isAdmin) {
        await adjustUserTokens(user.id, details.finalCost);
      }
      setIsSubmitting(false);
      return;
    }
    
    const newReservation = reservationResult.newReservation;
    
    setAllReservations(prevReservations => [...prevReservations, newReservation]);
    
    if (!isAdmin) {
      const newTokens = (user.tokens ?? 0) - details.finalCost;
      const updatedUser = { ...user, tokens: newTokens };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      window.dispatchEvent(new Event('userUpdated'));
    }
    
    setSelectedSlots([]);
    setIsSubmitting(false);
    
    toast({
        title: "預約成功！",
        description: `已為您安排在 ${assignedRoom.roomName.replace('房間', '枱號')}。${isAdmin ? '' : `並成功扣除 HKD ${details.finalCost.toFixed(2)}。`}`
    });

    const query = new URLSearchParams({
        roomId: assignedRoom.roomId,
        roomName: assignedRoom.roomName,
        date: dateStr,
        startTime,
        endTime,
        ref: newReservation.id,
    }).toString();

    window.location.assign(`/reservation-confirmation?${query}`);
  };

  const getEndTime = (startTime: string) => {
    if (!startTime) return '';
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + 30, 0, 0);
    return format(date, 'HH:mm');
  };

  useEffect(() => {
    if (sortedSlots.length > 0) {
      const lastSlot = sortedSlots[sortedSlots.length - 1];
      const lastSlotElement = slotRefs.current.get(lastSlot.time);
      const panelElement = confirmationPanelRef.current;

      if (lastSlotElement && panelElement) {
        const buttonRect = lastSlotElement.getBoundingClientRect();
        const panelHeight = panelElement.offsetHeight;
        const viewportHeight = window.innerHeight;

        if (buttonRect.bottom > (viewportHeight - panelHeight)) {
          const scrollOffset = buttonRect.bottom - viewportHeight + panelHeight + 20;
          window.scrollBy({
            top: scrollOffset,
            behavior: 'smooth',
          });
        }
      }
    }
  }, [sortedSlots]);
  
  const handleClearSelection = () => {
    setSelectedSlots([]);
    setIsSoloBooking(false);
  };

  const renderSlotButton = (time: string) => {
    if (!selectedDate) return null;
    const [hours, minutes] = time.split(':').map(Number);
    
    const isPast = isMounted && isBefore(setMinutes(setHours(new Date(selectedDate), hours), minutes), new Date());
    const slotAvailability = availability.get(time) || 0;
    const isDisabled = isPast || slotAvailability >= 2;
    const isSelected = selectedSlots.some(slot => isSameDay(slot.date, selectedDate) && slot.time === time);

    const variant = isSelected ? 'default' : (isDisabled ? 'secondary' : 'outline');
    
    return (
      <div
        ref={(el) => { if (el) slotRefs.current.set(time, el); else slotRefs.current.delete(time); }}
      >
        <Button
          variant={variant}
          disabled={isDisabled}
          onClick={() => handleSlotClick(time)}
          className={cn("h-auto py-1.5 w-full", isDisabled && "text-muted-foreground")}
        >
          <span className="font-normal">{time} - {getEndTime(time)}</span>
        </Button>
      </div>
    );
  };

  const getConfirmationPanelTitle = () => {
      if (sortedSlots.length === 0) return '';
      
      const firstSlot = sortedSlots[0];
      const lastSlot = sortedSlots[sortedSlots.length - 1];
      
      const startDateStr = format(firstSlot.date, 'yyyy年MM月dd日');
      const endDateStr = format(lastSlot.date, 'yyyy年MM月dd日');
      
      if (startDateStr === endDateStr) {
          return startDateStr;
      }
      
      return `${startDateStr} 至 ${endDateStr}`;
  }

  return (
    <main className="flex flex-col items-center p-4 space-y-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title.replace(/\\(.*\\)/, '').trim()}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {pricingTiers.map((tier, index) => (
              <Card key={index} className="text-center p-3 border-2 border-dashed">
                <p className="text-sm text-muted-foreground">{tier.title}</p>
                <p className="text-sm text-muted-foreground">{tier.timeRange}</p>
                <p className="text-2xl font-bold mt-1 text-primary">{tier.price}</p>
              </Card>
            ))}
          </div>
          <div>
            <h3 className="text-lg font-medium mb-2">1. 選擇日期</h3>
            <DateSelector
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    if (selectedSlots.length !== 1) {
                      setSelectedDate(date);
                      setSelectedSlots([]); // Clear selection if not in range selection mode
                    } else {
                       setSelectedDate(date);
                    }
                  }
                }}
              />
          </div>

          {selectedDate && (
            <div>
              <h3 className="text-lg font-medium mb-2">2. 選擇時段</h3>
              <p className="text-sm text-muted-foreground mb-4">
                顯示 <span className="font-semibold text-primary text-lg">{format(selectedDate, "yyyy年MM月dd日")}</span> 的可預約時段
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {timeSlots.map(time => renderSlotButton(time))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {selectedSlots.length > 0 && (
        <Card ref={confirmationPanelRef} className="w-full max-w-md sticky bottom-4 shadow-lg border-primary border-2 animate-in fade-in-0 zoom-in-95">
          <CardContent className="p-4 flex flex-col gap-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-medium">預約詳情</h3>
                    <Button variant="ghost" size="sm" onClick={handleClearSelection}>取消選擇</Button>
                </div>
                <div className="border p-4 rounded-md bg-muted/50 text-center space-y-1">
                  {sortedSlots.length > 0 && (
                    <>
                      <p className="font-semibold">{getConfirmationPanelTitle()}</p>
                      <p className="text-2xl font-bold">
                        {sortedSlots[0].time} - {getEndTime(sortedSlots[sortedSlots.length - 1].time)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        共 {sortedSlots.length * 0.5} 小時
                      </p>
                    </>
                  )}
                </div>
              </div>
             
              <div className="flex items-start space-x-3 rounded-md border p-4">
                <input
                  type="checkbox"
                  id="solo-practice-checkbox"
                  checked={isSoloBooking}
                  onChange={(e) => setIsSoloBooking(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-primary text-primary focus:ring-primary"
                />
                <div className="grid gap-1.5 leading-none">
                  <label htmlFor="solo-practice-checkbox" className="font-medium cursor-pointer">一人練波 (享折扣優惠)</label>
                  <p className="text-xs text-muted-foreground">
                    如選擇此項，全時段只可一人練習，不可替換。如發現多於一人，將會徵收差價及附加費。
                  </p>
                </div>
              </div>

              {(isSoloBooking || (user && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin'))) ? (
                  <div className="text-right space-y-1">
                      {(isSoloBooking && !(user && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin'))) && (
                          <p className="text-sm text-green-600">已套用一人練波折扣</p>
                      )}
                      {(user && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin')) && (
                          <p className="text-sm text-blue-600">已套用會員折扣</p>
                      )}
                      <span className="text-muted-foreground line-through text-sm">原價 HKD ${totalCost.toFixed(2)}</span>
                      <p className="font-semibold">總額: <span className="text-xl font-bold text-primary">HKD {bookingCost.toFixed(2)}</span></p>
                  </div>
              ) : (
                  <div className="flex items-center justify-between">
                      <span className="font-semibold">總額</span>
                      <span className="text-xl font-bold">HKD ${bookingCost.toFixed(2)}</span>
                  </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                  <Button variant="outline" className="w-full" onClick={handleAddToCart}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    加入購物車
                  </Button>
                  {cart.length > 0 ? (
                     <Button className="w-full" onClick={handleAddToCartAndCheckout}>
                        到購物車結算
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button className="w-full" onClick={handleImmediateBooking} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        立即預約
                    </Button>
                  )}
              </div>
          </CardContent>
        </Card>
      )}

      <ConfirmationDialog
        open={isConfirmationOpen}
        onOpenChange={setIsConfirmationOpen}
        reservationData={
          sortedSlots.length > 0 ? {
            roomName: determineRoomForBooking(sortedSlots)?.roomName || '枱號',
            date: sortedSlots[0].date,
            startTime: sortedSlots[0].time,
            endTime: getEndTime(sortedSlots[sortedSlots.length - 1].time),
            duration: sortedSlots.length * 0.5,
            cost: bookingCost,
            originalCost: totalCost,
            isVip: user !== null && (user.role.toLowerCase() === 'vip' || user.role.toLowerCase() === 'vvip' || user.role.toLowerCase() === 'admin'),
            isSolo: isSoloBooking,
          } : null
        }
        terms={termsAndConditions}
        onConfirm={processTokenPayment}
        isLoggedIn={!!user}
        userBalance={user?.role?.toLowerCase() === 'admin' ? Infinity : user?.tokens}
      />

      <AlertDialog open={isConflictDialogOpen} onOpenChange={setIsConflictDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>預約衝突</AlertDialogTitle>
            <AlertDialogDescription>
              您選擇的時間範圍内包含了無法預約的時段 (兩張枱均已預約)。請重新選擇。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>確定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isDurationErrorDialogOpen} onOpenChange={setIsDurationErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>預約時間不足</AlertDialogTitle>
            <AlertDialogDescription>
              必需最少一小時。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>確定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

    