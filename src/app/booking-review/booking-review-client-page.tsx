
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { format, setHours, setMinutes, isBefore, subDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DateSelector } from '@/components/custom/date-selector';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import type { RoomSettings } from '@/app/admin/settings/actions';
import type { Reservation } from '@/types';
import { getReservationsForDateRange } from '../(main)/new-reservation/actions';

type BookingReviewClientPageProps = {
    settings: RoomSettings;
    initialReservations: Reservation[]; // Will be empty from the server
}

export function BookingReviewClientPage({ settings, initialReservations }: BookingReviewClientPageProps) {
  const { toast } = useToast();
  
  const { newReservationPage } = settings;
  const { pricingTiers } = newReservationPage;

  const [allReservations, setAllReservations] = useState<Reservation[]>(initialReservations);
  const [availability, setAvailability] = useState<Map<string, number>>(new Map());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
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
    
    // Set up an interval to refetch data periodically to keep it "live"
    const intervalId = setInterval(fetchReservations, 60000); // every 60 seconds

    // Cleanup interval on component unmount or when selectedDate changes
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
                // Standard booking within the same day
                return res.date === dateStr && currentTimeIndex >= startTimeIndex && currentTimeIndex < endTimeIndex;
            }
            else if (endTimeIndex < startTimeIndex) { // Overnight booking
                // If the booking started yesterday, it's active today before its end time
                if (res.date === format(subDays(selectedDate, 1), 'yyyy-MM-dd')) {
                    return currentTimeIndex < endTimeIndex;
                }
                // If the booking starts today, it's active from its start time onwards
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


  const getEndTime = (startTime: string) => {
    if (!startTime) return '';
    const [hours, minutes] = startTime.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes + 30, 0, 0);
    return format(date, 'HH:mm');
  };

  const renderSlotButton = (time: string) => {
    if (!selectedDate) return null;
    const [hours, minutes] = time.split(':').map(Number);
    
    const isPast = isMounted && isBefore(setMinutes(setHours(new Date(selectedDate), hours), minutes), new Date());
    const slotAvailability = availability.get(time) || 0;
    const isDisabled = isPast || slotAvailability >= 2;

    const variant = isDisabled ? 'secondary' : 'outline';
    
    return (
        <Button
          variant={variant}
          disabled // ALWAYS disabled for this read-only page
          className={cn(
            "h-auto py-1.5 w-full cursor-not-allowed", // Enforce disabled cursor
            isDisabled && "text-muted-foreground",
            !isDisabled && "font-semibold text-foreground" // Make available slots bold and black
          )}
        >
          <span>{time} - {getEndTime(time)}</span>
        </Button>
    );
  };

  return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>時段預覽</CardTitle>
          <CardDescription>此頁面僅供預覽，不可預約。</CardDescription>
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
                    setSelectedDate(date);
                  }
                }}
              />
          </div>

          {selectedDate && (
            <div>
              <h3 className="text-lg font-medium mb-2">2. 可用時段</h3>
              <p className="text-sm text-muted-foreground mb-4">
                顯示 <span className="font-semibold text-primary text-lg">{format(selectedDate, "yyyy年MM月dd日")}</span> 的可預約時段
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {timeSlots.map(time => (
                      <div key={time}>
                        {renderSlotButton(time)}
                      </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
  );
}
