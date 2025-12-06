
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';

export type ReservationSummary = {
  roomName: string;
  date: Date;
  startTime: string;
  endTime: string;
  duration: number;
  cost: number;
  originalCost: number;
  isVip: boolean;
  isSolo: boolean;
};

export type ConfirmationDetails = {
    finalCost: number;
    isSolo: boolean;
};

type ConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationData: ReservationSummary | null;
  terms: string;
  onConfirm: (details: ConfirmationDetails) => void;
  isLoggedIn: boolean;
  userBalance?: number;
};

export function ConfirmationDialog({
  open,
  onOpenChange,
  reservationData: details, // Renamed for clarity inside component
  terms,
  onConfirm,
  isLoggedIn,
  userBalance
}: ConfirmationDialogProps) {
  const scrollableContentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // The isSoloPractice state is now managed inside the parent component.
  // This dialog now only receives the final decision via `details.isSolo`.

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (scrollableContentRef.current) {
          scrollableContentRef.current.scrollTop = 0;
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!details) return null;
  
  const handleConfirm = () => {
    if (userBalance !== undefined && userBalance < details.cost) {
      toast({
        variant: 'destructive',
        title: '餘額不足',
        description: `此預約需要 HKD ${details.cost.toFixed(2)}，但您目前只有 HKD ${userBalance?.toFixed(2) ?? 0}。`,
      });
      return;
    }
    onConfirm({ finalCost: details.cost, isSolo: details.isSolo });
    onOpenChange(false);
  }

  const PriceDisplay = () => {
    if (details.isSolo) {
      return (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">原價</span>
            <span className="text-muted-foreground line-through">HKD ${details.originalCost.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-base">
            <span>一人練波價</span>
            <Badge variant="secondary" className="text-base bg-green-200 text-green-800">HKD {details.cost.toFixed(2)}</Badge>
          </div>
        </>
      );
    }
    
    if (details.isVip) {
      return (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">原價</span>
            <span className="text-muted-foreground line-through">HKD ${details.originalCost.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold text-base">
            <span>會員價</span>
            <Badge variant="secondary" className="text-base">HKD {details.cost.toFixed(2)}</Badge>
          </div>
        </>
      );
    }

    return (
      <div className="flex items-center justify-between font-semibold text-base">
        <span>總額</span>
        <span className="text-lg">HKD ${details.cost.toFixed(2)}</span>
      </div>
    );
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md flex flex-col max-h-[90vh] p-0 sm:max-h-[85vh]">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle>確認您的預約</DialogTitle>
          <DialogDescription>請核對以下預約詳情及條款，並確認付款。</DialogDescription>
        </DialogHeader>
        
        <div ref={scrollableContentRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="border p-4 rounded-md bg-muted/50 text-center space-y-2">
            <p className="text-2xl font-bold text-primary">{details.roomName.replace('房間', '枱號')}</p>
            <p className="font-semibold">{format(details.date, 'yyyy年MM月dd日')}</p>
            <p className="text-2xl font-bold">
              {details.startTime} - {details.endTime}
            </p>
            <p className="text-sm text-muted-foreground">
              共 {details.duration} 小時
            </p>
          </div>
          <div className="space-y-2">
            <PriceDisplay />
          </div>
          
          <div>
            <Label className="text-base font-semibold">條款及細則</Label>
            <ScrollArea className="h-32 w-full rounded-md border p-4 text-sm mt-2 bg-muted/30">
              <div className="whitespace-pre-wrap">{terms}</div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 bg-muted/50 border-t">
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button onClick={handleConfirm} className="w-full sm:w-auto">
            {isLoggedIn ? `確認付款 (HKD ${details.cost.toFixed(2)})` : "登入以繼續"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
