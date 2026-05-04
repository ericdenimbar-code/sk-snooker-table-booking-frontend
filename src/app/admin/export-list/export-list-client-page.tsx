'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

import { exportReservationsExcel } from './actions';

function downloadBase64File(base64: string, fileName: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportListClientPage() {
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear - 5; y <= currentYear + 2; y += 1) {
      list.push(y);
    }
    return list;
  }, [currentYear]);

  const [year, setYear] = useState(String(currentYear));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    const y = Number.parseInt(year, 10);
    const m = Number.parseInt(month, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m)) {
      toast({
        variant: 'destructive',
        title: '無法匯出',
        description: '請選擇有效的年份與月份。',
      });
      return;
    }

    setBusy(true);
    try {
      const result = await exportReservationsExcel(y, m);
      if (!result.success) {
        toast({
          variant: 'destructive',
          title: '匯出失敗',
          description: result.error,
        });
        return;
      }

      downloadBase64File(result.base64, result.fileName);

      toast({
        title: '匯出完成',
        description: `已下載 ${result.fileName}（${result.rowCount} 筆）`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold md:text-2xl">匯出清單</h1>
        <p className="text-sm text-muted-foreground mt-1">
          依預約日期所屬月份從資料庫查詢後匯出 Excel；查詢於伺服端以日期範圍鎖定單月，不會載入全部預約。
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="grid gap-2 w-full sm:w-[180px]">
          <span className="text-sm font-medium">年份</span>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger aria-label="選擇年份">
              <SelectValue placeholder="年份" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y} 年
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 w-full sm:w-[160px]">
          <span className="text-sm font-medium">月份</span>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger aria-label="選擇月份">
              <SelectValue placeholder="月份" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => (
                <SelectItem key={mo} value={String(mo)}>
                  {mo} 月
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          onClick={handleExport}
          disabled={busy}
          className="sm:mb-0.5"
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-2 h-4 w-4" />
          )}
          匯出 Excel
        </Button>
      </div>
    </div>
  );
}
