
'use server';

import { google } from 'googleapis';
import { db } from '@/lib/firebase-admin';
import type { Reservation, TemporaryAccess } from '@/types';
import { parseISO, isWithinInterval, add, sub, format } from 'date-fns';

// 環境變數檢查
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

// Main room calendars
const CALENDAR_ID_ROOM_1 = process.env.GOOGLE_CALENDAR_ID_ROOM_1;
const CALENDAR_ID_ROOM_2 = process.env.GOOGLE_CALENDAR_ID_ROOM_2;

// Rotational door control calendars
const CALENDAR_ID_DOOR_CONTROL_1A = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_1A;
const CALENDAR_ID_DOOR_CONTROL_1B = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_1B;
const CALENDAR_ID_DOOR_CONTROL_2A = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_2A;
const CALENDAR_ID_DOOR_CONTROL_2B = process.env.GOOGLE_CALENDAR_ID_DOOR_CONTROL_2B;

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
 */
async function createEvent(calendarId: string, details: EventDetails): Promise<{ eventId: string; eventLink: string; } | null> {
    try {
        const response = await calendar.events.insert({
            calendarId: calendarId,
            requestBody: {
                summary: details.summary,
                description: details.description,
                start: { dateTime: details.start, timeZone: 'Asia/Hong_Kong' },
                end: { dateTime: details.end, timeZone: 'Asia/Hong_Kong' },
                id: details.eventId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase(), 
            },
        });

        if (response.data) {
            console.log(`✅ Successfully created event '${response.data.id}' in calendar '${calendarId}'.`);
            return { eventId: response.data.id!, eventLink: response.data.htmlLink! };
        }
        return null;

    } catch (error: any) {
        if (error.code === 409) {
            console.warn(`Event '${details.eventId}' already exists in calendar '${calendarId}'.`);
            return { eventId: details.eventId, eventLink: '' };
        }
        console.error(`❌ Error creating event in calendar '${calendarId}':`, error);
        return null;
    }
}

/**
 * Main function to create calendar events for a reservation or temporary access.
 */
export async function createGoogleCalendarEvent(reservation: Reservation | TemporaryAccess): Promise<boolean> {
    if (!hasGoogleConfig) {
        console.error("Cannot create calendar event: Google Calendar API is not configured.");
        return false;
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
        return false;
    }

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
        const doorCalendarId = getCalendarIdBySlot(availableSlot);
        if (doorCalendarId) {
            await createEvent(doorCalendarId, {
                summary: qrSecret,
                description: `User: ${userIdentifier} | Ref: ${reservation.id} | Slot: ${availableSlot}`,
                start: doorControlStart.toISOString(),
                end: doorControlEnd.toISOString(),
                eventId: reservation.id,
            });
            return true;
        }
    } else {
        console.error(`No available A/B slot found for room ${roomIdForSlotFinding} at the requested time.`);
        const fallbackSlot: Slot = roomIdForSlotFinding === '1' ? '1A' : '2A';
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
        return false;
    }
    
    return false;
}

/**
 * Deletes a Google Calendar event from all relevant calendars.
 */
export async function deleteGoogleCalendarEvent(reservation: Reservation | TemporaryAccess): Promise<boolean> {
    if (!hasGoogleConfig) return false;
    
    const eventId = reservation.id;
    const sanitizedEventId = eventId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    
    const tryDelete = async (calendarId: string) => {
        try {
            await calendar.events.delete({ calendarId, eventId: sanitizedEventId });
            console.log(`Successfully deleted event ${sanitizedEventId} from calendar ${calendarId}`);
        } catch (error: any) {
            if (error.code !== 404) {
                console.warn(`Could not delete event ${sanitizedEventId} from ${calendarId}: ${error.message}`);
            }
        }
    };
    
    if ('validFrom' in reservation) {
        const allDoorCalendars = [CALENDAR_ID_DOOR_CONTROL_1A, CALENDAR_ID_DOOR_CONTROL_1B, CALENDAR_ID_DOOR_CONTROL_2A, CALENDAR_ID_DOOR_CONTROL_2B].filter(Boolean) as string[];
        for (const calId of allDoorCalendars) {
            await tryDelete(calId);
        }
        console.log(`Attempted deletion of temp access event ${eventId} from all door calendars.`);
        return true;
    }

    const regularReservation = reservation as Reservation;
    const { roomId } = regularReservation;

    const mainCalendarId = getCalendarIdBySlot(roomId as '1' | '2');
    if (mainCalendarId) {
        await tryDelete(mainCalendarId);
    }
    
    const doorSlots: Slot[] = roomId === '1' ? ['1A', '1B'] : ['2A', '2B'];
    for (const slot of doorSlots) {
        const doorCalendarId = getCalendarIdBySlot(slot);
        if (doorCalendarId) {
            await tryDelete(doorCalendarId);
        }
    }
    
    console.log(`Attempted deletion of all calendar events for reservation ${eventId}`);
    return true;
}
