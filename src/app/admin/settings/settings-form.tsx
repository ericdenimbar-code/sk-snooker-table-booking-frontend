
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
import { Loader2, Info, ImagePlus, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

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

  const handleQrCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        handlePaymentInfoChange('staticFpsQrCodeUrl', reader.result as string);
      };
      reader.readAsDataURL(file);
    } else if (file) {
      toast({
        variant: 'destructive',
        title: '檔案類型錯誤',
        description: '請選擇一個圖片檔案。',
      });
    }
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
          <CardTitle>全域付款及電郵伺服器設定</CardTitle>
          <CardDescription>設定使用者在提交增值請求後看到的轉帳資訊，以及系統發送郵件所使用的 SMTP 伺服器。此設定為全站共用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>重要提示：關於應用程式密碼</AlertTitle>
                <AlertDescription>
                    基於安全理由，系統**不會**顯示您已儲存的電郵伺服器密碼。如需更新密碼，請直接在下方欄位輸入新的 Google「應用程式密碼」。如果留空，則會沿用舊有密碼。
                </AlertDescription>
            </Alert>
           <div className="grid gap-4 md:grid-cols-2">
                <div className="grid gap-1.5">
                    <Label htmlFor="fps-number">FPS 收款電話號碼</Label>
                    <Input
                    id="fps-number"
                    value={paymentInfo.fpsNumber || ''}
                    onChange={e => handlePaymentInfoChange('fpsNumber', e.target.value)}
                    placeholder="例如：98765432"
                    />
                </div>
                 <div className="grid gap-1.5">
                    <Label htmlFor="email-from-name">寄件人顯示名稱</Label>
                    <Input
                    id="email-from-name"
                    value={paymentInfo.emailFromName || ''}
                    onChange={e => handlePaymentInfoChange('emailFromName', e.target.value)}
                    placeholder="例如：Snooker Kingdom Booking"
                    />
                </div>
           </div>
          <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="accountHolderName">收款方戶口持有人姓名</Label>
                <Input
                  id="accountHolderName"
                  value={paymentInfo.accountHolderName || ''}
                  onChange={e => handlePaymentInfoChange('accountHolderName', e.target.value)}
                  placeholder="例如：CHAN T** M***"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bankName">收款方銀行</Label>
                <Input
                  id="bankName"
                  value={paymentInfo.bankName || ''}
                  onChange={e => handlePaymentInfoChange('bankName', e.target.value)}
                  placeholder="例如：HSBC"
                />
              </div>
          </div>
           <div className="grid gap-2">
              <Label htmlFor="qr-code-upload">靜態 FPS 收款 QR Code</Label>
              <div className="flex items-center gap-4">
                {paymentInfo.staticFpsQrCodeUrl ? (
                  <div className="relative">
                    <img src={paymentInfo.staticFpsQrCodeUrl} alt="QR Code Preview" className="h-24 w-24 rounded-md border object-contain p-1" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={() => handlePaymentInfoChange('staticFpsQrCodeUrl', '')}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-md border border-dashed bg-muted">
                    <ImagePlus className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <Input
                  id="qr-code-upload"
                  type="file"
                  accept="image/png, image/jpeg"
                  onChange={handleQrCodeChange}
                  className="max-w-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                上傳由您的銀行 App 產生的永久性收款 QR Code 圖片。
              </p>
            </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5">
                <Label htmlFor="email-user">電郵伺服器用戶名稱 (Gmail)</Label>
                <Input
                id="email-user"
                value={paymentInfo.emailServerUser || ''}
                onChange={e => handlePaymentInfoChange('emailServerUser', e.target.value)}
                placeholder="your-email@gmail.com"
                />
            </div>
            <div className="grid gap-1.5">
                <Label htmlFor="email-password">電郵伺服器密碼 (Google 應用程式密碼)</Label>
                <Input
                id="email-password"
                type="password"
                onChange={e => handlePaymentInfoChange('emailServerPassword', e.target.value)}
                placeholder="留空即沿用舊密碼"
                />
            </div>
          </div>
          <Button onClick={handlePaymentInfoSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            儲存全域設定
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
