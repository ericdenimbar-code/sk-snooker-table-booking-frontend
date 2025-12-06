
'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateRoomSettings, type RoomSettings, type HomeAssistantConfig } from '../settings/actions';

type HomeAssistantFormProps = {
  initialSettings: HomeAssistantConfig;
};

export function HomeAssistantForm({ initialSettings }: HomeAssistantFormProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleFieldChange = (field: keyof HomeAssistantConfig, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    // HA settings are stored globally under room '1'
    const result = await updateRoomSettings('1', { homeAssistant: settings });
    if (result.success) {
      toast({
        title: '儲存成功',
        description: 'Home Assistant 整合設定已成功更新。',
      });
    } else {
      toast({
        variant: 'destructive',
        title: '儲存失敗',
        description: `更新失敗：${result.error}`,
      });
    }
    setIsSubmitting(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home Assistant 整合設定</CardTitle>
        <CardDescription>
          連接到您的 Home Assistant 實例以觸發自動化。此設定為全站共用。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ha-url">Home Assistant URL</Label>
          <Input
            id="ha-url"
            value={settings.haUrl}
            onChange={e => handleFieldChange('haUrl', e.target.value)}
            placeholder="例如：http://homeassistant.local:8123"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ha-token">長期存取權杖 (Long-Lived Access Token)</Label>
          <Input
            id="ha-token"
            type="password"
            value={settings.haToken}
            onChange={e => handleFieldChange('haToken', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ha-webhook">自動化 Webhook ID</Label>
          <Input
            id="ha-webhook"
            value={settings.haWebhookId}
            onChange={e => handleFieldChange('haWebhookId', e.target.value)}
            placeholder="在 Home Assistant 自動化中設定的 Webhook ID"
          />
        </div>
      </CardContent>
      <CardContent>
        <Button onClick={handleSave} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          儲存 Home Assistant 設定
        </Button>
      </CardContent>
    </Card>
  );
}

    