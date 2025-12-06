
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import type { RoomSettings, NewReservationPageContent, PricingTier, SlotData, PaymentInfo } from './actions';
import { updateRoomSettings, updatePaymentInfo } from './actions';
import { Loader2 } from 'lucide-react';

type SettingsPanelProps = {
  roomName: string;
  settings: RoomSettings;
  onSettingsChange: React.Dispatch<React.SetStateAction<RoomSettings>>;
  isSubmitting: boolean;
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
};

function SettingsPanel({ roomName, settings, onSettingsChange, isSubmitting, setIsSubmitting }: SettingsPanelProps) {
  const { toast } = useToast();

  const {
    newReservationPage,
    tokenPriceHKD,
    slotCostsData,
    termsAndConditions,
    purchaseTokensIntro,
  } = settings;

  const handleFieldChange = (field: keyof RoomSettings, value: any) => {
    onSettingsChange(prev => ({ ...prev, [field]: value }));
  };

  const handlePageContentChange = (field: keyof NewReservationPageContent, value: string) => {
    onSettingsChange(prev => ({
      ...prev,
      newReservationPage: { ...prev.newReservationPage, [field]: value },
    }));
  };

  const handleTierChange = (index: number, field: keyof PricingTier, value: string) => {
    const newTiers = [...newReservationPage.pricingTiers] as [PricingTier, PricingTier, PricingTier];
    newTiers[index] = { ...newTiers[index], [field]: value };
    onSettingsChange(prev => ({
      ...prev,
      newReservationPage: { ...prev.newReservationPage, pricingTiers: newTiers },
    }));
  };
  
  const handleSlotCostChange = (id: number, value: string) => {
    const newCosts = slotCostsData.map(slot =>
      slot.id === id ? { ...slot, cost: Number(value) || 0 } : slot
    );
    handleFieldChange('slotCostsData', newCosts);
  };

  const handleSubmit = async (data: Partial<RoomSettings>, sectionName: string) => {
    setIsSubmitting(true);
    const result = await updateRoomSettings(settings.id, data);
    if (result.success) {
      toast({
        title: `${roomName} 已更新`,
        description: `${sectionName}已成功儲存至資料庫。`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: `無法儲存${sectionName}：${result.error}`,
      });
    }
    setIsSubmitting(false);
  };
  
  const renderSubmitButton = (onClick: () => void, text: string) => (
    <Button onClick={onClick} disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {text}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>「新增預訂」頁面內容 ({roomName})</CardTitle>
          <CardDescription>設定在預約頁面頂部顯示的標題和描述。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`page-title-${settings.id}`}>頁面標題</Label>
            <Input
              id={`page-title-${settings.id}`}
              value={newReservationPage.title}
              onChange={e => handlePageContentChange('title', e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`page-description-${settings.id}`}>頁面描述</Label>
            <Textarea
              id={`page-description-${settings.id}`}
              value={newReservationPage.description}
              onChange={e => handlePageContentChange('description', e.target.value)}
            />
          </div>
          {renderSubmitButton(() => handleSubmit({ newReservationPage }, '頁面內容'), '儲存頁面內容')}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>價目表內容設定 ({roomName})</CardTitle>
          <CardDescription>設定在預約頁面顯示的三個價目表區塊。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {newReservationPage.pricingTiers.map((tier, index) => (
              <div key={index} className="space-y-4 border p-4 rounded-lg">
                <h4 className="font-semibold text-center text-muted-foreground">區塊 {index + 1}</h4>
                <div className="grid gap-1.5">
                  <Label htmlFor={`tier-title-${settings.id}-${index}`}>小字 (標題)</Label>
                  <Input id={`tier-title-${settings.id}-${index}`} value={tier.title} onChange={e => handleTierChange(index, 'title', e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`tier-time-${settings.id}-${index}`}>小字 (時段)</Label>
                  <Input id={`tier-time-${settings.id}-${index}`} value={tier.timeRange} onChange={e => handleTierChange(index, 'timeRange', e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`tier-price-${settings.id}-${index}`}>大字 (價錢)</Label>
                  <Input id={`tier-price-${settings.id}-${index}`} value={tier.price} onChange={e => handleTierChange(index, 'price', e.target.value)} />
                </div>
              </div>
            ))}
          </div>
          {renderSubmitButton(() => handleSubmit({ newReservationPage }, '價目表'), '儲存價目表')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>「帳戶增值」頁面內容</CardTitle>
          <CardDescription>設定在增值頁面顯示的流程簡介。此設定為全站共用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`purchase-intro-${settings.id}`}>流程簡介</Label>
            <Textarea
              id={`purchase-intro-${settings.id}`}
              value={purchaseTokensIntro}
              onChange={e => handleFieldChange('purchaseTokensIntro', e.target.value)}
              className="min-h-[150px] whitespace-pre-wrap"
            />
          </div>
          {renderSubmitButton(() => handleSubmit({ purchaseTokensIntro }, '帳戶增值流程簡介'), '儲存流程簡介')}
        </CardContent>
      </Card>

       <Card>
        <CardHeader>
          <CardTitle>餘額與港幣兌換率 ({roomName})</CardTitle>
          <CardDescription>設定 1 港幣等於多少帳戶餘額。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid w-full max-w-xs items-center gap-1.5">
            <Label htmlFor={`token-price-${settings.id}`}>1 港幣兌換</Label>
            <Input id={`token-price-${settings.id}`} type="number" value={tokenPriceHKD} onChange={(e) => handleFieldChange('tokenPriceHKD', Number(e.target.value))} min="0" />
          </div>
          {renderSubmitButton(() => handleSubmit({ tokenPriceHKD }, '兌換率'), '確定')}
        </CardContent>
      </Card>

       <Card>
        <CardHeader>
          <CardTitle>各時段價格 ({roomName})</CardTitle>
          <CardDescription>為每個 30 分鐘的時段設定所需的港幣費用。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-4">
            {slotCostsData.map(slot => (
              <div key={slot.id} className="space-y-2">
                <Label htmlFor={`slot-${settings.id}-${slot.id}`}>{slot.timeLabel}</Label>
                <Input id={`slot-${settings.id}-${slot.id}`} type="number" value={slot.cost} onChange={(e) => handleSlotCostChange(slot.id, e.target.value)} min="0" step="1" className="w-full"/>
              </div>
            ))}
          </div>
          <div className="mt-6">
            {renderSubmitButton(() => handleSubmit({ slotCostsData }, '時段價格'), '全部確定')}
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>預約條款設定 ({roomName})</CardTitle>
          <CardDescription>設定使用者在確認預約前看到的條款及細則。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea value={termsAndConditions} onChange={(e) => handleFieldChange('termsAndConditions', e.target.value)} className="min-h-[250px] whitespace-pre-wrap" />
          {renderSubmitButton(() => handleSubmit({ termsAndConditions }, '預約條款'), '儲存變更')}
        </CardContent>
      </Card>
    </>
  );
}

type SettingsFormProps = {
    initialRoom1Settings: RoomSettings;
    initialRoom2Settings: RoomSettings;
    initialPaymentInfo: PaymentInfo;
}

export function SettingsForm({ initialRoom1Settings, initialRoom2Settings, initialPaymentInfo }: SettingsFormProps) {
  const [currentRoom, setCurrentRoom] = useState('1');
  const [room1Settings, setRoom1Settings] = useState(initialRoom1Settings);
  const [room2Settings, setRoom2Settings] = useState(initialRoom2Settings);
  const [paymentInfo, setPaymentInfo] = useState(initialPaymentInfo);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handlePaymentInfoChange = (field: keyof PaymentInfo, value: string) => {
    setPaymentInfo(prev => ({ ...prev, [field]: value }));
  };

  const handlePaymentInfoSubmit = async () => {
    setIsSubmitting(true);
    const result = await updatePaymentInfo(paymentInfo);
    if (result.success) {
      toast({
        title: `付款資訊已更新`,
        description: `全域付款資訊已成功儲存至資料庫。`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: `無法儲存付款資訊：${result.error}`,
      });
    }
    setIsSubmitting(false);
  };
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>全域付款資訊設定</CardTitle>
          <CardDescription>設定使用者在提交增值請求後看到的轉帳資訊。此設定為全站共用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="grid gap-1.5">
            <Label htmlFor="fps-number">FPS 收款電話號碼</Label>
            <Input
              id="fps-number"
              value={paymentInfo.fpsNumber || ''}
              onChange={e => handlePaymentInfoChange('fpsNumber', e.target.value)}
              placeholder="例如：98765432"
            />
             <p className="text-xs text-muted-foreground">此號碼將用於生成 FPS QR Code。</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payment-info">銀行轉帳資訊 (後備)</Label>
            <Textarea
              id="payment-info"
              value={paymentInfo.bankDetails}
              onChange={e => handlePaymentInfoChange('bankDetails', e.target.value)}
              className="min-h-[120px] whitespace-pre-wrap"
              placeholder="請在此處輸入您的銀行轉帳資訊 (例如：銀行名稱、戶口號碼、戶口持有人姓名)。"
            />
          </div>
          <Button onClick={handlePaymentInfoSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            儲存付款資訊
          </Button>
        </CardContent>
      </Card>

      <Tabs value={currentRoom} onValueChange={setCurrentRoom}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="1">枱號一</TabsTrigger>
          <TabsTrigger value="2">枱號二</TabsTrigger>
        </TabsList>
        <TabsContent value="1" className="space-y-6 mt-6">
          <SettingsPanel roomName="枱號一" settings={room1Settings} onSettingsChange={setRoom1Settings} isSubmitting={isSubmitting} setIsSubmitting={setIsSubmitting} />
        </TabsContent>
        <TabsContent value="2" className="space-y-6 mt-6">
          <SettingsPanel roomName="枱號二" settings={room2Settings} onSettingsChange={setRoom2Settings} isSubmitting={isSubmitting} setIsSubmitting={setIsSubmitting} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
