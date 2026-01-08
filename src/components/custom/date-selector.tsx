'use client';

import React, { useState, useMemo } from 'react';
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  startOfToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  endOfMonth,
  startOfMonth,
} from 'date-fns';
import { zhHK } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DateSelectorProps = {
  selected: Date | undefined;
  onSelect: (date: Date | undefined) => void;
  maxDate?: Date;
};

export function DateSelector({ selected, onSelect, maxDate }: DateSelectorProps) {
  const today = startOfToday();
  const [displayDate, setDisplayDate] = useState(selected || today);
  const effectiveMaxDate = maxDate || addDays(today, 29); // Default to 30 days if no maxDate is provided

  // State for touch controls
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const minSwipeDistance = 50;

  const daysInWeek = useMemo(() => {
    const start = startOfWeek(displayDate, { locale: zhHK });
    const end = endOfWeek(displayDate, { locale: zhHK });
    return eachDayOfInterval({ start, end });
  }, [displayDate]);
  
  const isDateDisabled = (date: Date) => date < today || date > effectiveMaxDate;

  const handleSelect = (date: Date) => {
    if (isDateDisabled(date)) return;
    onSelect(date);
    setDisplayDate(date);
  };
  
  const nextWeek = () => setDisplayDate(addWeeks(displayDate, 1));
  const prevWeek = () => setDisplayDate(subWeeks(displayDate, 1));
  const nextMonth = () => setDisplayDate(addMonths(displayDate, 1));
  const prevMonth = () => setDisplayDate(subMonths(displayDate, 1));
  
  const canGoToPrevWeek = endOfWeek(subWeeks(startOfWeek(displayDate, { locale: zhHK }), 1), { locale: zhHK }) >= today;
  const canGoToNextWeek = startOfWeek(addWeeks(startOfWeek(displayDate, { locale: zhHK }), 1), { locale: zhHK }) <= effectiveMaxDate;
  const canGoToPrevMonth = endOfMonth(subMonths(displayDate, 1)) >= today;
  const canGoToNextMonth = startOfMonth(addMonths(displayDate, 1)) <= effectiveMaxDate;

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && canGoToNextWeek) {
      nextWeek();
    } else if (isRightSwipe && canGoToPrevWeek) {
      prevWeek();
    }

    setTouchStart(null);
    setTouchEnd(null);
  };


  return (
    <div className="w-full bg-card p-2 sm:p-4 rounded-lg border">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-baseline">
            <Button onClick={prevMonth} variant="ghost" size="icon" className="h-8 w-8" disabled={!canGoToPrevMonth}><ChevronLeft className="w-5 h-5" /></Button>
            <div className="mx-2 text-center">
                <span className="text-2xl font-bold text-primary">{format(displayDate, 'M')}</span>
                <span className="text-2xl font-bold text-primary mr-1">月</span>
                <span className="text-sm text-muted-foreground">{format(displayDate, 'yyyy')}</span>
            </div>
            <Button onClick={nextMonth} variant="ghost" size="icon" className="h-8 w-8" disabled={!canGoToNextMonth}><ChevronRight className="w-5 h-5" /></Button>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"><CalendarIcon className="w-5 h-5" /></Button>
          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"><Plus className="w-5 h-5" /></Button>
          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground"><MoreVertical className="w-5 h-5" /></Button>
        </div>
      </div>

      {/* Weekdays + Dates container */}
      <div className="relative flex items-center">
          <Button onClick={prevWeek} variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 shrink-0" disabled={!canGoToPrevWeek}>
              <ChevronLeft className="w-5 h-5" />
          </Button>
          <div
            className="grid grid-cols-7 w-full text-center"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {daysInWeek.map((day, index) => (
              <div key={day.toString()}>
                <div className="text-sm text-muted-foreground mb-2">{weekdays[index]}</div>
                <button
                  onClick={() => handleSelect(day)}
                  disabled={isDateDisabled(day)}
                  className={cn(
                    'w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-base transition-colors mx-auto',
                    'disabled:text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed',
                    !isSameMonth(day, displayDate) && !isSameDay(day, today) && 'text-muted-foreground',
                    selected && isSameDay(day, selected) 
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90' 
                      : 'hover:bg-accent',
                    isDateDisabled(day) && 'hover:bg-transparent'
                  )}
                >
                  {format(day, 'd')}
                </button>
              </div>
            ))}
          </div>
           <Button onClick={nextWeek} variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10 shrink-0" disabled={!canGoToNextWeek}>
              <ChevronRight className="w-5 h-5" />
          </Button>
      </div>
    </div>
  );
}
