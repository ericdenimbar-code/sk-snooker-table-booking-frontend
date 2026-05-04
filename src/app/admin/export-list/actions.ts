'use server';

import { db } from '@/lib/firebase-admin';
import type { Reservation } from '@/types';
import { endOfMonth, format, startOfMonth } from 'date-fns';

/** 專案預約資料存於 `reservations` 集合，以 `date`（yyyy-MM-dd）作為查詢欄位。 */
const RESERVATIONS_COLLECTION = 'reservations';

type MonthQueryResponse = {
  success: boolean;
  error?: string;
  reservations?: Reservation[];
};

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
