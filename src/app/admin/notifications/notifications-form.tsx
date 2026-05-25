'use client';

import { useState } from 'react';
import type { NotificationBlock } from '@/lib/notifications/types';
import { publishSiteNotifications } from './actions';
import type { SerializedSiteNotifications } from '@/lib/notifications/serialize';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { DateTimePicker } from '@/components/custom/datetime-picker';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Megaphone, Smartphone } from 'lucide-react';
import { getEffectiveIsActive, isExpired } from '@/lib/notifications/time';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type NotificationsFormProps = {
  initialData: SerializedSiteNotifications;
};

function cloneBlock(block: SerializedSiteNotifications['popup']): SerializedSiteNotifications['popup'] {
  return { ...block };
}

function NotificationSection({
  title,
  description,
  icon: Icon,
  block,
  onChange,
  staged,
  onStage,
  isStaging,
}: {
  title: string;
  description: string;
  icon: typeof Megaphone;
  block: SerializedSiteNotifications['popup'];
  onChange: (next: SerializedSiteNotifications['popup']) => void;
  staged: boolean;
  onStage: () => void;
  isStaging: boolean;
}) {
  const parsedBlock: NotificationBlock = {
    content: block.content,
    startTime: block.startTime ? new Date(block.startTime) : null,
    endTime: block.endTime ? new Date(block.endTime) : null,
    isActive: block.isActive,
  };

  const expired = isExpired(parsedBlock.endTime);
  const effectiveActive = getEffectiveIsActive(parsedBlock);
  const dateFieldsMuted = !block.isActive;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <CardTitle>{title}</CardTitle>
          </div>
          <div className="flex flex-wrap gap-2">
            {staged && <Badge variant="secondary">已暫存</Badge>}
            {expired && block.isActive && (
              <Badge variant="outline" className="text-amber-700 border-amber-300">
                已過期（前端不顯示）
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${title}-content`}>公告內容</Label>
          <Textarea
            id={`${title}-content`}
            value={block.content}
            onChange={(e) => onChange({ ...block, content: e.target.value })}
            placeholder="輸入公告文字…"
            className="min-h-[120px]"
          />
        </div>

        <div
          className={cn(
            'grid gap-4 sm:grid-cols-2',
            dateFieldsMuted && 'opacity-50'
          )}
        >
          <DateTimePicker
            label="開始時間 (HKT)"
            value={parsedBlock.startTime}
            onChange={(startTime) =>
              onChange({
                ...block,
                startTime: startTime?.toISOString() ?? null,
              })
            }
          />
          <DateTimePicker
            label="結束時間 (HKT)"
            value={parsedBlock.endTime}
            onChange={(endTime) =>
              onChange({
                ...block,
                endTime: endTime?.toISOString() ?? null,
              })
            }
          />
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id={`${title}-active`}
            checked={block.isActive}
            onCheckedChange={(checked) =>
              onChange({ ...block, isActive: !!checked })
            }
          />
          <Label htmlFor={`${title}-active`} className="cursor-pointer font-normal">
            啟動此通知
            {!effectiveActive && block.isActive && !expired && (
              <span className="ml-2 text-xs text-muted-foreground">
                （尚未到開始時間）
              </span>
            )}
          </Label>
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onStage} disabled={isStaging}>
          {isStaging && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          儲存暫存
        </Button>
      </CardFooter>
    </Card>
  );
}

export function NotificationsForm({ initialData }: NotificationsFormProps) {
  const { toast } = useToast();
  const [popupDraft, setPopupDraft] = useState(() => cloneBlock(initialData.popup));
  const [topBannerDraft, setTopBannerDraft] = useState(() =>
    cloneBlock(initialData.topBanner)
  );
  const [stagedPopup, setStagedPopup] = useState<SerializedSiteNotifications['popup'] | null>(
    null
  );
  const [stagedTopBanner, setStagedTopBanner] = useState<
    SerializedSiteNotifications['topBanner'] | null
  >(null);
  const [popupStagedFlag, setPopupStagedFlag] = useState(false);
  const [topBannerStagedFlag, setTopBannerStagedFlag] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isStagingPopup, setIsStagingPopup] = useState(false);
  const [isStagingTopBanner, setIsStagingTopBanner] = useState(false);

  const handleStagePopup = () => {
    setIsStagingPopup(true);
    setStagedPopup(cloneBlock(popupDraft));
    setPopupStagedFlag(true);
    setTimeout(() => {
      setIsStagingPopup(false);
      toast({ title: '已暫存', description: '全屏彈窗設定已儲存至暫存區。' });
    }, 200);
  };

  const handleStageTopBanner = () => {
    setIsStagingTopBanner(true);
    setStagedTopBanner(cloneBlock(topBannerDraft));
    setTopBannerStagedFlag(true);
    setTimeout(() => {
      setIsStagingTopBanner(false);
      toast({ title: '已暫存', description: '頂部公告欄設定已儲存至暫存區。' });
    }, 200);
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    const payload: SerializedSiteNotifications = {
      popup: stagedPopup ?? popupDraft,
      topBanner: stagedTopBanner ?? topBannerDraft,
    };

    const result = await publishSiteNotifications(payload);
    if (result.success) {
      setPopupDraft(cloneBlock(payload.popup));
      setTopBannerDraft(cloneBlock(payload.topBanner));
      setStagedPopup(null);
      setStagedTopBanner(null);
      setPopupStagedFlag(false);
      setTopBannerStagedFlag(false);
      toast({
        title: '已生效',
        description: '通知設定已更新，所有在線用戶將即時看到變更。',
      });
    } else {
      toast({
        variant: 'destructive',
        title: '發布失敗',
        description: result.error ?? '未知錯誤',
      });
    }
    setIsPublishing(false);
  };

  const hasAnythingToPublish =
    popupStagedFlag ||
    topBannerStagedFlag ||
    stagedPopup !== null ||
    stagedTopBanner !== null;

  return (
    <div className="flex flex-col gap-6">
      <NotificationSection
        title="全屏彈窗 (登入後)"
        description="用戶登入後，每個瀏覽器 Session 僅顯示一次。須在有效時間內且已啟動才會顯示。"
        icon={Smartphone}
        block={popupDraft}
        onChange={setPopupDraft}
        staged={popupStagedFlag}
        onStage={handleStagePopup}
        isStaging={isStagingPopup}
      />

      <NotificationSection
        title="頂部公告欄"
        description="登入前後均會顯示，佔據螢幕頂部約 1/10 高度。用戶關閉後，本次 Session 內切換頁面仍保持關閉，直至內容更新。"
        icon={Megaphone}
        block={topBannerDraft}
        onChange={setTopBannerDraft}
        staged={topBannerStagedFlag}
        onStage={handleStageTopBanner}
        isStaging={isStagingTopBanner}
      />

      <Card className="border-primary/30 bg-muted/30">
        <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">確定生效</p>
            <p className="text-sm text-muted-foreground">
              按下後才會正式寫入 Firestore（settings/notifications），所有在線用戶透過即時監聽立即更新。
              {hasAnythingToPublish
                ? ' 將發布已暫存及目前表單內容。'
                : ' 若未暫存，將以目前表單內容發布。'}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={handlePublish}
            disabled={isPublishing}
            className="shrink-0"
          >
            {isPublishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            確定生效
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
