'use client';

import React, { useState, useMemo, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { generateFpsQrCodeUrl } from '@/lib/fps-qrcode';
import Image from 'next/image';
import type { PaymentInfo } from '@/app/admin/settings/actions';
import { Loader2 } from 'lucide-react';

export type MixedPaymentReservationDetails = {
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

export type MixedPaymentDetails = {
    totalCost: number;
    fpsAmount: number;
    useBalance: boolean;
    tokenAmountToUse: number;
    isSolo: boolean;
};

type MixedPaymentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationData: MixedPaymentReservationDetails | null;
  userBalance: number;
  paymentInfo: PaymentInfo;
  onConfirm: (details: MixedPaymentDetails) => void;
};

export function MixedPaymentDialog({
  open,
  onOpenChange,
  reservationData: details,
  userBalance,
  paymentInfo,
  onConfirm,
}: MixedPaymentDialogProps) {
  const [paymentOption, setPaymentOption] = useState<'mix' | 'full_fps'>('mix');
  const [showQrCode, setShowQrCode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Reset state when dialog opens
    if (open) {
      setPaymentOption('mix');
      setShowQrCode(false);
      setIsProcessing(false);
    }
  }, [open]);

  const amounts = useMemo(() => {
    if (!details) return { fpsAmount: 0, tokenAmount: 0 };
    
    if (paymentOption === 'full_fps') {
      return { fpsAmount: details.cost, tokenAmount: 0 };
    }
    // Default is 'mix'
    const tokenAmount = Math.min(userBalance, details.cost);
    const fpsAmount = details.cost - tokenAmount;
    return { fpsAmount, tokenAmount };
  }, [details, userBalance, paymentOption]);

  const fpsQrUrl = useMemo(() => {
    if (!details || !paymentInfo.fpsNumber || !showQrCode) return '';
    const tempRefId = `BOOK-${Date.now()}`; // Use a temporary ID for QR generation
    return generateFpsQrCodeUrl(paymentInfo.fpsNumber, amounts.fpsAmount, tempRefId);
  }, [details, paymentInfo.fpsNumber, amounts.fpsAmount, showQrCode]);

  const handleProceedToPayment = () => {
    setShowQrCode(true);
  };
  
  const handleFinalConfirm = async () => {
    if (!details) return;
    setIsProcessing(true);
    await onConfirm({
        totalCost: details.cost,
        fpsAmount: amounts.fpsAmount,
        useBalance: paymentOption === 'mix',
        tokenAmountToUse: amounts.tokenAmount,
        isSolo: details.isSolo,
    });
    setIsProcessing(false);
  };

  if (!details) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>支付選項</DialogTitle>
          <DialogDescription>
            您的帳戶餘額不足以支付全額。請選擇如何支付。
          </DialogDescription>
        </DialogHeader>

        {!showQrCode ? (
          <div className="py-4 space-y-6">
            <div className="border rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-lg font-semibold">
                <span>預訂總額:</span>
                <span>HKD {details.cost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>您的餘額:</span>
                <span>HKD {userBalance.toFixed(2)}</span>
              </div>
            </div>

            <RadioGroup value={paymentOption} onValueChange={(v) => setPaymentOption(v as 'mix' | 'full_fps')}>
              <Label htmlFor="opt-mix" className="flex items-start space-x-3 rounded-md border p-4 cursor-pointer hover:bg-accent [&:has([data-state=checked])]:border-primary">
                <RadioGroupItem value="mix" id="opt-mix" className="mt-1" />
                <div>
                  <p className="font-semibold">混合支付 (推薦)</p>
                  <p className="text-sm text-muted-foreground">
                    使用全部餘額 (HKD {userBalance.toFixed(2)})，並以 FPS 支付差額 <span className="font-bold text-primary">HKD {(details.cost - userBalance).toFixed(2)}</span>。
                  </p>
                </div>
              </Label>
              <Label htmlFor="opt-full" className="flex items-start space-x-3 rounded-md border p-4 cursor-pointer hover:bg-accent [&:has([data-state=checked])]:border-primary">
                <RadioGroupItem value="full_fps" id="opt-full" className="mt-1" />
                 <div>
                  <p className="font-semibold">全額 FPS 支付</p>
                  <p className="text-sm text-muted-foreground">
                    保留您的帳戶餘額，並以 FPS 支付全部款項 <span className="font-bold text-primary">HKD {details.cost.toFixed(2)}</span>。
                  </p>
                </div>
              </Label>
            </RadioGroup>
          </div>
        ) : (
          <div className="py-4 space-y-4 text-center">
            <h3 className="font-semibold">請掃描 FPS QR Code</h3>
            <p className="text-muted-foreground">
              請支付 <span className="font-bold text-lg text-primary">HKD {amounts.fpsAmount.toFixed(2)}</span>
            </p>
            {fpsQrUrl ? (
              <div className="mx-auto bg-white p-2 border rounded-md inline-block">
                <Image src={fpsQrUrl} alt="FPS QR Code" width={200} height={200} />
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center">
                <p className="text-destructive">無法產生 QR Code，請檢查後台 FPS 設定。</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              **重要提示：** 完成付款後，請務必點擊下方的「我已付款，建立預約」按鈕以鎖定您的預訂時段。
            </p>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isProcessing}>取消</Button>
          </DialogClose>
          {!showQrCode ? (
            <Button onClick={handleProceedToPayment}>下一步</Button>
          ) : (
            <Button onClick={handleFinalConfirm} disabled={isProcessing}>
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              我已付款，建立預約
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
