
import { createHash } from 'crypto';
import { google } from 'googleapis';
import { db } from '@/lib/firebase-admin';
import type { Reservation, TemporaryAccess } from '@/types';
import { parseISO, isWithinInterval, add, sub, format } from 'date-fns';

const HKT_TIMEZONE = 'Asia/Hong_Kong';

/** Google Calendar 自訂 event id 僅允許 a-v 與 0-9；Firestore ID 可能含 w-z 導致 insert 失敗 */
export function getGoogleCalendarEventId(raw: string): string {
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function toGoogleCalendarEventId(raw: string): string {
    return getGoogleCalendarEventId(raw);
}

function parseEventInstant(isoOrDate: string | Date): Date {
    return typeof isoOrDate === 'string' ? parseISO(isoOrDate) : isoOrDate;
}

// 環境變數檢查
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Main room calendars
const CALENDAR_ID_ROOM_1 = process.env.GOOGLE_CALENDAR_ID_ROOM_1;
const CALENDAR_ID_ROOM_2 = process.env.GOOGLE_CALENDAR_ID_ROOM_2;

// Rotational door control calendars
const CALENDAR_ID_DOOR_CONTROL_1A = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_1A?.trim();
const CALENDAR_ID_DOOR_CONTROL_1B = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_1B?.trim();
const CALENDAR_ID_DOOR_CONTROL_2A = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_2A?.trim();
const CALENDAR_ID_DOOR_CONTROL_2B = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_2B?.trim();
const CALENDAR_ID_DOOR_CONTROL_TEMP = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_temp?.trim();

const hasGoogleConfig = SERVICE_ACCOUNT_EMAIL && PRIVATE_KEY && CALENDAR_ID_ROOM_1 && CALENDAR_ID_ROOM_2 && CALENDAR_ID_DOOR_CONTROL_1A && CALENDAR_ID_DOOR_CONTROL_1B && CALENDAR_ID_DOOR_CONTROL_2A && CALENDAR_ID_DOOR_CONTROL_2B;

if (!hasGoogleConfig) {
  console.warn("⚠️ Google Calendar API is not fully configured. One or more calendar IDs might be missing.");
}

// 建立 JWT 客戶端
const auth = new google.auth.JWT({
  email: SERVICE_ACCOUNT_EMAIL,
  key: PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

// 建立 Calendar API 實例
const calendar = google.calendar({ version: 'v3', auth });

type RoomId = '1' | '2' | 'door_control';
type Slot = '1A' | '1B' | '2A' | '2B';

type EventDetails = {
    summary: string;
    description: string;
    start: string; // ISO 8601 格式
    end: string;   // ISO 8601 格式
    eventId: string;
    doorAccessRequestId?: string;
}

/**
 * Finds an available door control calendar slot for a given time range.
 * @param roomId The room ID ('1' or '2').
 * @param start The start time of the booking.
 * @param end The end time of the booking.
 * @returns The slot ID ('1A', '1B', '2A', '2B') or null if none is available.
 */
async function findAvailableSlot(roomId: '1' | '2', start: Date, end: Date): Promise<Slot | null> {
    const slots: Slot[] = roomId === '1' ? ['1A', '1B'] : ['2A', '2B'];
    
    for (const slot of slots) {
        const calendarId = getCalendarIdBySlot(slot);
        if (!calendarId) continue;

        try {
            const response = await calendar.events.list({
                calendarId: calendarId,
                timeMin: start.toISOString(),
                timeMax: end.toISOString(),
                singleEvents: true,
                maxResults: 1,
            });

            if (!response.data.items || response.data.items.length === 0) {
                // This slot is free, return it
                return slot;
            }
        } catch (error) {
            console.error(`Error checking availability for slot ${slot}:`, error);
            // If we can't check a slot, assume it's busy and try the next one.
        }
    }

    // No free slot found
    return null;
}

/**
 * Gets the Google Calendar ID based on the room or slot ID.
 * @param id The ID of the room or slot.
 * @returns The corresponding Google Calendar ID.
 */
function getCalendarIdBySlot(id: RoomId | Slot): string | undefined {
    switch (id) {
        case '1': return CALENDAR_ID_ROOM_1;
        case '2': return CALENDAR_ID_ROOM_2;
        case '1A': return CALENDAR_ID_DOOR_CONTROL_1A;
        case '1B': return CALENDAR_ID_DOOR_CONTROL_1B;
        case '2A': return CALENDAR_ID_DOOR_CONTROL_2A;
        case '2B': return CALENDAR_ID_DOOR_CONTROL_2B;
        case 'door_control': return CALENDAR_ID_DOOR_CONTROL_1A; 
        default: 
            console.error(`Invalid ID passed to getCalendarIdBySlot: ${id}`);
            return undefined;
    }
}

/**
 * Creates a Google Calendar event in the specified calendar.
 * Uses dateTime + timeZone (never `date` all-day).
 */
async function createEvent(calendarId: string, details: EventDetails): Promise<{ eventId: string; eventLink: string; } | null> {
    const startTime = parseEventInstant(details.start);
    const endTime = parseEventInstant(details.end);
    const startDateTime = startTime.toISOString();
    const endDateTime = endTime.toISOString();
    const googleEventId = toGoogleCalendarEventId(details.eventId);
    const doorAccessRequestId = details.doorAccessRequestId ?? details.eventId;

    console.log('[Google Calendar] events.insert planned:', {
        calendarId,
        door_access_request_id: doorAccessRequestId,
        googleEventId,
        startDateTime,
        endDateTime,
        timeZone: HKT_TIMEZONE,
        summaryPreview: details.summary.slice(0, 12),
    });

    if (endTime <= startTime) {
        console.error('[Google Calendar] invalid range: end must be after start', {
            startDateTime,
            endDateTime,
        });
        return null;
    }

    const requestBody = {
        summary: details.summary,
        description: details.description,
        start: { dateTime: startDateTime, timeZone: HKT_TIMEZONE },
        end: { dateTime: endDateTime, timeZone: HKT_TIMEZONE },
        id: googleEventId,
        extendedProperties: {
            private: {
                door_access_request_id: doorAccessRequestId,
            },
        },
    };

    try {
        const response = await calendar.events.insert({
            calendarId,
            requestBody,
        });

        if (response.data) {
            console.log(`✅ Google Calendar event created: id=${response.data.id} calendar=${calendarId}`);
            return { eventId: response.data.id!, eventLink: response.data.htmlLink ?? '' };
        }
        console.error('[Google Calendar] insert returned empty response.data', { calendarId, googleEventId });
        return null;
    } catch (error: unknown) {
        const err = error as {
            code?: number;
            message?: string;
            response?: { data?: unknown };
            errors?: unknown;
        };
        const apiError = err.response?.data ?? err.errors ?? err.message ?? String(error);

        if (err.code === 409) {
            console.warn(`[Google Calendar] event already exists (409): googleEventId=${googleEventId}`, apiError);
            return { eventId: googleEventId, eventLink: '' };
        }

        console.error(`❌ Google Calendar events.insert failed:`, {
            calendarId,
            googleEventId,
            door_access_request_id: doorAccessRequestId,
            startDateTime,
            endDateTime,
            apiError,
            message: err.message,
        });
        return null;
    }
}

export type GoogleCalendarReservationMeta = {
    googleCalendarEventId: string;
    googleCalendarDoorSlot?: Slot;
};

export type GoogleCalendarDeleteResult = {
    success: boolean;
    deletedCalendars: string[];
    errors: string[];
};

export function getReservationCalendarTargets(reservation: Reservation): { calendarId: string; eventId: string }[] {
    const eventId = reservation.googleCalendarEventId ?? getGoogleCalendarEventId(reservation.id);
    const targets: { calendarId: string; eventId: string }[] = [];

    const mainCalendarId = getCalendarIdBySlot(reservation.roomId as '1' | '2');
    if (mainCalendarId) {
        targets.push({ calendarId: mainCalendarId, eventId });
    }

    const doorSlots: Slot[] = reservation.googleCalendarDoorSlot
        ? [reservation.googleCalendarDoorSlot]
        : reservation.roomId === '1'
          ? ['1A', '1B']
          : ['2A', '2B'];

    for (const slot of doorSlots) {
        const doorCalendarId = getCalendarIdBySlot(slot);
        if (doorCalendarId) {
            targets.push({ calendarId: doorCalendarId, eventId });
        }
    }

    return targets;
}

export async function eventExistsOnCalendar(calendarId: string, eventId: string): Promise<boolean> {
    if (!hasGoogleConfig) return false;
    try {
        await calendar.events.get({ calendarId, eventId });
        return true;
    } catch (error: unknown) {
        const err = error as { code?: number };
        if (err.code === 404) return false;
        throw error;
    }
}

export async function deleteGoogleCalendarEventsForReservation(
    reservation: Reservation,
): Promise<GoogleCalendarDeleteResult> {
    if (!hasGoogleConfig) {
        return { success: false, deletedCalendars: [], errors: ['Google Calendar API 未設定'] };
    }

    const targets = getReservationCalendarTargets(reservation);
    const deletedCalendars: string[] = [];
    const errors: string[] = [];

    for (const { calendarId, eventId } of targets) {
        try {
            await calendar.events.delete({ calendarId, eventId });
            deletedCalendars.push(calendarId);
            console.log(`[Google Calendar] deleted event ${eventId} from ${calendarId}`);
        } catch (error: unknown) {
            const err = error as { code?: number; message?: string };
            if (err.code === 404) {
                continue;
            }
            const msg = err.message ?? String(error);
            errors.push(`${calendarId}: ${msg}`);
            console.warn(`[Google Calendar] delete failed ${eventId}@${calendarId}: ${msg}`);
        }
    }

    return {
        success: errors.length === 0,
        deletedCalendars,
        errors,
    };
}

/**
 * Main function to create calendar events for a reservation or temporary access.
 */
export async function createGoogleCalendarEvent(
    reservation: Reservation | TemporaryAccess,
): Promise<{ ok: boolean; meta?: GoogleCalendarReservationMeta }> {
    if (!hasGoogleConfig) {
        console.error("Cannot create calendar event: Google Calendar API is not configured.");
        return { ok: false };
    }

    const isTempAccess = 'validFrom' in reservation;
    
    let eventSummary: string;
    let userIdentifier: string;
    let qrSecret: string;
    let bookingStart: Date;
    let bookingEnd: Date;
    let roomIdForSlotFinding: '1' | '2';
    
    if (isTempAccess) {
        const tempAccess = reservation as TemporaryAccess;
        userIdentifier = tempAccess.userEmail;
        eventSummary = userIdentifier.split('@')[0];
        qrSecret = tempAccess.id;
        bookingStart = parseISO(tempAccess.validFrom);
        bookingEnd = parseISO(tempAccess.validUntil);
        roomIdForSlotFinding = '1'; 
    } else {
        const regularReservation = reservation as Reservation;
        userIdentifier = regularReservation.userName;
        eventSummary = regularReservation.userName;
        qrSecret = regularReservation.qrSecret;
        bookingStart = parseISO(`${regularReservation.date}T${regularReservation.startTime}:00+08:00`);
        bookingEnd = parseISO(`${regularReservation.date}T${regularReservation.endTime}:00+08:00`);

        if (bookingEnd <= bookingStart) {
            bookingEnd = add(bookingEnd, { days: 1 });
        }
        roomIdForSlotFinding = regularReservation.roomId as '1' | '2';
    }
    
    if (!qrSecret) {
        console.error(`Cannot create calendar event: QR Secret is missing for reservation ${reservation.id}`);
        return { ok: false };
    }

    const googleCalendarEventId = getGoogleCalendarEventId(reservation.id);
    let doorSlotUsed: Slot | undefined;

    if (!isTempAccess) {
        const mainCalendarId = getCalendarIdBySlot(roomIdForSlotFinding);
        if (mainCalendarId) {
            await createEvent(mainCalendarId, {
                summary: eventSummary,
                description: `Ref: ${reservation.id}\nPhone: ${(reservation as Reservation).userPhone || 'N/A'}`,
                start: bookingStart.toISOString(),
                end: bookingEnd.toISOString(),
                eventId: reservation.id,
            });
        }
    }
    
    const doorControlStart = isTempAccess ? bookingStart : sub(bookingStart, { minutes: 15 });
    const doorControlEnd = isTempAccess ? bookingEnd : add(bookingEnd, { minutes: 15 });

    let availableSlot = await findAvailableSlot(roomIdForSlotFinding, doorControlStart, doorControlEnd);
    
    if (isTempAccess && !availableSlot) {
        availableSlot = await findAvailableSlot('2', doorControlStart, doorControlEnd);
    }

    if (availableSlot) {
        doorSlotUsed = availableSlot;
        const doorCalendarId = getCalendarIdBySlot(availableSlot);
        if (doorCalendarId) {
            const created = await createEvent(doorCalendarId, {
                summary: qrSecret,
                description: `User: ${userIdentifier} | Ref: ${reservation.id} | Slot: ${availableSlot}`,
                start: doorControlStart.toISOString(),
                end: doorControlEnd.toISOString(),
                eventId: reservation.id,
            });
            return {
                ok: !!created,
                meta: isTempAccess ? undefined : { googleCalendarEventId, googleCalendarDoorSlot: doorSlotUsed },
            };
        }
    } else {
        console.error(`No available A/B slot found for room ${roomIdForSlotFinding} at the requested time.`);
        const fallbackSlot: Slot = roomIdForSlotFinding === '1' ? '1A' : '2A';
        doorSlotUsed = fallbackSlot;
        const fallbackCalendarId = getCalendarIdBySlot(fallbackSlot);
        if (fallbackCalendarId) {
            console.warn(`Falling back to primary slot ${fallbackSlot} for door control.`);
            await createEvent(fallbackCalendarId, {
                summary: qrSecret,
                description: `User: ${userIdentifier} | Ref: ${reservation.id} | SLOT FALLBACK`,
                start: doorControlStart.toISOString(),
                end: doorControlEnd.toISOString(),
                eventId: reservation.id,
            });
        }
        return {
            ok: false,
            meta: isTempAccess ? undefined : { googleCalendarEventId, googleCalendarDoorSlot: doorSlotUsed },
        };
    }
    
    return { ok: false };
}

/**
 * 單筆申請（VVIP / Admin）：寫入專用日曆，eventId 為申請 ID，可重疊新增。
 */
export async function syncTemporaryAccessApplicationToCalendar(params: {
    applicationId: string;
    secret: string;
    startIso: string;
    endIso: string;
    description?: string;
}): Promise<boolean> {
    if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
        console.error('[Google Calendar] missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
        return false;
    }
    if (!CALENDAR_ID_DOOR_CONTROL_TEMP) {
        console.error('[Google Calendar] missing GOOGLE_CALENDAR_ID_DOOR_CONTROL_temp');
        return false;
    }

    console.log('[Google Calendar] syncTemporaryAccessApplicationToCalendar:', {
        applicationId: params.applicationId,
        startIso: params.startIso,
        endIso: params.endIso,
        calendarId: CALENDAR_ID_DOOR_CONTROL_TEMP,
    });

    const created = await createEvent(CALENDAR_ID_DOOR_CONTROL_TEMP, {
        summary: params.secret,
        description: params.description ?? `臨時進出 ${params.applicationId}`,
        start: params.startIso,
        end: params.endIso,
        eventId: params.applicationId,
        doorAccessRequestId: params.applicationId,
    });

    if (!created) {
        console.error('[Google Calendar] syncTemporaryAccessApplicationToCalendar failed', {
            applicationId: params.applicationId,
        });
    }
    return !!created;
}

/**
 * Deletes a Google Calendar event from all relevant calendars.
 */
export async function deleteGoogleCalendarEvent(reservation: Reservation | TemporaryAccess): Promise<boolean> {
    if (!hasGoogleConfig) return false;

    if ('validFrom' in reservation) {
        const temp = reservation as TemporaryAccess;
        if (temp.segmentKey) {
            return true;
        }
        const eventId = getGoogleCalendarEventId(reservation.id);
        const allDoorCalendars = [CALENDAR_ID_DOOR_CONTROL_1A, CALENDAR_ID_DOOR_CONTROL_1B, CALENDAR_ID_DOOR_CONTROL_2A, CALENDAR_ID_DOOR_CONTROL_2B].filter(Boolean) as string[];
        for (const calId of allDoorCalendars) {
            try {
                await calendar.events.delete({ calendarId: calId, eventId });
            } catch (error: unknown) {
                const err = error as { code?: number; message?: string };
                if (err.code !== 404) {
                    console.warn(`Could not delete temp access event from ${calId}: ${err.message}`);
                }
            }
        }
        return true;
    }

    const result = await deleteGoogleCalendarEventsForReservation(reservation as Reservation);
    return result.success || result.deletedCalendars.length > 0;
}
