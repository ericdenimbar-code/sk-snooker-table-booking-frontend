'use client';

import { useState } from 'react';
import type { RoomSettings, ContactInfo, SiteBranding } from './settings/actions';
import { updateRoomSettings } from './settings/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ImagePlus, X } from 'lucide-react';

type DashboardFormProps = {
  initialRoom1Settings: RoomSettings;
  initialRoom2Settings: RoomSettings;
};

export function DashboardForm({ initialRoom1Settings, initialRoom2Settings }: DashboardFormProps) {
  // State for global settings (from room '1')
  const [siteBranding, setSiteBranding] = useState(
    initialRoom1Settings.siteBranding || { name: 'RoomReserva', logoUrl: '' }
  );
  const [contactInfo, setContactInfo] = useState(
    initialRoom1Settings.contactInfo || { name: '', email: '', whatsapp: '', address: '', additionalInfo: '' }
  );

  // Loading states
  const [isBrandingSubmitting, setIsBrandingSubmitting] = useState(false);
  const [isContactSubmitting, setIsContactSubmitting] = useState(false);
  
  const { toast } = useToast();

  const handleBrandingChange = (field: keyof SiteBranding, value: string) => {
    setSiteBranding(prev => ({ ...prev, [field]: value }));
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSiteBranding(prev => ({ ...prev, logoUrl: reader.result as string }));
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

  const handleRemoveLogo = () => {
    setSiteBranding(prev => ({ ...prev, logoUrl: '' }));
  };

  const handleSaveBranding = async () => {
    setIsBrandingSubmitting(true);
    const result = await updateRoomSettings('1', { siteBranding });
    if (result.success) {
      toast({
        title: '儲存成功',
        description: '商標及公司名稱已成功更新。前台頁面將在下次載入時顯示新設定。',
      });
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: `更新失敗：${result.error}`,
      });
    }
    setIsBrandingSubmitting(false);
  };
  
  const handleContactInfoChange = (field: keyof ContactInfo, value: string) => {
    setContactInfo(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveContactInfo = async () => {
    setIsContactSubmitting(true);
    const result = await updateRoomSettings('1', { contactInfo });
    if (result.success) {
      toast({
        title: '儲存成功',
        description: '「聯絡我們」的資訊已成功更新。',
      });
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: `更新失敗：${result.error}`,
      });
    }
    setIsContactSubmitting(false);
  };

  return (
    <div className="grid gap-6">
       <Card>
        <CardHeader>
          <CardTitle>商標及公司名稱設定</CardTitle>
          <CardDescription>
            此處的設定將會顯示在前台左上角的 LOGO 及名稱位置。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="company-name">公司名稱</Label>
              <Input
                id="company-name"
                value={siteBranding.name}
                onChange={(e) => handleBrandingChange('name', e.target.value)}
                placeholder="例如：RoomReserva"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="logo-upload">上載商標</Label>
              <div className="flex items-center gap-4">
                {siteBranding.logoUrl ? (
                  <div className="relative">
                    <img src={siteBranding.logoUrl} alt="Logo Preview" className="h-16 w-16 rounded-md border object-contain p-1" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={handleRemoveLogo}><X className="h-4 w-4" /></Button>
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed bg-muted">
                    <ImagePlus className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <Input
                  id="logo-upload"
                  type="file"
                  accept="image/png, image/jpeg, image/svg+xml, image/gif"
                  onChange={handleLogoChange}
                  className="max-w-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                建議尺寸：128x128 像素，支援 PNG, JPG, SVG, GIF 格式。
              </p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button onClick={handleSaveBranding} disabled={isBrandingSubmitting}>
            {isBrandingSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            儲存商標設定
          </Button>
        </CardFooter>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>「聯絡我們」頁面內容</CardTitle>
          <CardDescription>
            此處輸入的聯絡資訊，將會顯示在使用者前台的「聯絡我們」頁面。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contact-name">聯絡人</Label>
              <Input
                id="contact-name"
                value={contactInfo.name}
                onChange={(e) => handleContactInfoChange('name', e.target.value)}
                placeholder="例如：客戶服務部"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-email">電郵</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactInfo.email}
                onChange={(e) => handleContactInfoChange('email', e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-whatsapp">WhatsApp 聯絡號碼</Label>
              <Input
                id="contact-whatsapp"
                value={contactInfo.whatsapp}
                onChange={(e) => handleContactInfoChange('whatsapp', e.target.value)}
                placeholder="例如：85212345678 (包含國家/地区代碼)"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-address">地址</Label>
              <Input
                id="contact-address"
                value={contactInfo.address}
                onChange={(e) => handleContactInfoChange('address', e.target.value)}
                placeholder="輸入完整地址"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contact-additional-info">額外資訊</Label>
              <Textarea
                id="contact-additional-info"
                value={contactInfo.additionalInfo || ''}
                onChange={(e) => handleContactInfoChange('additionalInfo', e.target.value)}
                placeholder="可在此輸入額外文字，將會顯示在聯絡頁面底部。"
                className="min-h-[120px]"
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
          <Button onClick={handleSaveContactInfo} disabled={isContactSubmitting}>
            {isContactSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            儲存變更
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
