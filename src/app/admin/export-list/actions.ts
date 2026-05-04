'use server';

import { db } from '@/lib/firebase-admin';
import type { Reservation } from '@/types';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import * as XLSX from 'xlsx';

/** 專案預約資料存於 `reservations` 集合，以 `date`（yyyy-MM-dd）作為查詢欄位。 */
const RESERVATIONS_COLLECTION = 'reservations';

type MonthQueryResponse = {
  success: boolean;
  error?: string;
  reservations?: Reservation[];
};

type ExportExcelResponse =
  | { success: true; fileName: string; base64: string; rowCount: number }
  | { success: false; error: string };

function partyLabel(r: Reservation): string {
  if (r.isSoloPractice === true) {
    return '1（一人練波）';
  }
  if (r.isSoloPractice === false) {
    return '一般預訂';
  }
  return '—';
}

function rowsForSheet(reservations: Reservation[]) {
  return reservations.map((r) => ({
    預約日期: r.date,
    開始時間: r.startTime,
    結束時間: r.endTime,
    客戶名稱: r.userName,
    聯絡電話: r.userPhone,
    桌號: r.roomName,
    人數: partyLabel(r),
    狀態: r.status,
    代幣: r.costInTokens,
  }));
}

/**
 * 以 Firestore 的 orderBy + startAt/endAt 鎖定單一月份，不在記憶體全量篩選。
 */
export async function getReservationsForCalendarMonth(
  year: number,
  month: number
): Promise<MonthQueryResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { success: false, error: '年份或月份無效。' };
  }

  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(new Date(year, month - 1, 1));
  const startStr = format(monthStart, 'yyyy-MM-dd');
  const endStr = format(monthEnd, 'yyyy-MM-dd');

  try {
    const snapshot = await db
      .collection(RESERVATIONS_COLLECTION)
      .orderBy('date')
      .startAt(startStr)
      .endAt(endStr)
      .get();

    const reservations = snapshot.docs.map((doc) => doc.data() as Reservation);
    return { success: true, reservations };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('getReservationsForCalendarMonth:', message);
    return {
      success: false,
      error: `讀取預約資料失敗：${message}`,
    };
  }
}

/**
 * 在伺服端產生 xlsx（依賴僅安裝於 Node，不進入瀏覽器 bundle），避免部署環境對客戶端解析 `xlsx` 失敗。
 */
export async function exportReservationsExcel(
  year: number,
  month: number
): Promise<ExportExcelResponse> {
  const loaded = await getReservationsForCalendarMonth(year, month);
  if (!loaded.success || !loaded.reservations) {
    return { success: false, error: loaded.error ?? '讀取預約失敗' };
  }

  const rows = rowsForSheet(loaded.reservations);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '預約');
  const padMonth = String(month).padStart(2, '0');
  const fileName = `sk-booking-報表-${year}-${padMonth}.xlsx`;
  const buf = XLSX.write(wb, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;

  return {
    success: true,
    fileName,
    base64: buf.toString('base64'),
    rowCount: loaded.reservations.length,
  };
}
