
'use server';

import { google } from 'googleapis';
import type { Reservation } from '@/types';
import { add } from 'date-fns';
import { zonedTimeToUtc } from 'date-fns-tz';

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

const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';

async function findAvailableDoorSlot(roomId: '1' | '2', startDateTime: Date, endDateTime: Date) {
    const relevantSlots = roomId === '1' 
        ? { '1A': CALENDAR_ID_DOOR_CONTROL_1A, '1B': CALENDAR_ID_DOOR_CONTROL_1B }
        : { '2A': CALENDAR_ID_DOOR_CONTROL_2A, '2B': CALENDAR_ID_DOOR_CONTROL_2B };

    for (const [slot, calendarId] of Object.entries(relevantSlots)) {
        if (!calendarId) continue;
        try {
            const response = await calendar.events.list({
                calendarId: calendarId,
                timeMin: startDateTime.toISOString(),
                timeMax: endDateTime.toISOString(),
                maxResults: 1,
                singleEvents: true,
            });
            if (!response.data.items || response.data.items.length === 0) {
                return calendarId; // This slot is free
            }
        } catch (error) {
            console.error(`Error checking calendar ${calendarId} for slot ${slot}:`, error);
        }
    }
    // Fallback to the primary 'A' slot if both are busy, assuming overwrite is acceptable.
    console.warn(`No free door control slot found for room ${roomId}. Falling back to primary slot.`);
    return roomId === '1' ? CALENDAR_ID_DOOR_CONTROL_1A : CALENDAR_ID_DOOR_CONTROL_2A;
}


export async function createGoogleCalendarEvent(reservation: Reservation): Promise<boolean> {
    if (!hasGoogleConfig) {
        console.error("Cannot create calendar event: Google Calendar API is not configured.");
        return false;
    }

    const { id, roomId, roomName, userName, userPhone, date, startTime, endTime, qrSecret } = reservation;

    // --- Timezone Correction ---
    // Create Date objects by interpreting the local time strings as being in the 'Asia/Hong_Kong' timezone.
    const startDateTime = zonedTimeToUtc(`${date}T${startTime}:00`, HONG_KONG_TIME_ZONE);
    let endDateTime = zonedTimeToUtc(`${date}T${endTime}:00`, HONG_KONG_TIME_ZONE);
    // --- End of Timezone Correction ---

    // Handle overnight bookings
    if (endDateTime <= startDateTime) {
        endDateTime = add(endDateTime, { days: 1 });
    }

    const eventDetails = {
        summary: `${userName} - ${roomName.replace('房間', '枱號')}`,
        description: `Ref: ${id}\n電話: ${userPhone || '未提供'}`,
        start: { dateTime: startDateTime.toISOString(), timeZone: HONG_KONG_TIME_ZONE },
        end: { dateTime: endDateTime.toISOString(), timeZone: HONG_KONG_TIME_ZONE },
        id: id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    };
    
    const doorEventDetails = {
        ...eventDetails,
        summary: qrSecret, // Door control calendar uses the QR secret as the event title
        description: `開門碼\n用戶: ${userName}\nRef: ${id}`
    };

    try {
        // --- Create event in the main room calendar ---
        const mainCalendarId = roomId === '1' ? CALENDAR_ID_ROOM_1 : CALENDAR_ID_ROOM_2;
        await calendar.events.insert({ calendarId: mainCalendarId, requestBody: eventDetails });

        // --- Create event in an available door control calendar ---
        const doorCalendarId = await findAvailableDoorSlot(roomId as '1' | '2', startDateTime, endDateTime);
        if (doorCalendarId) {
            await calendar.events.insert({ calendarId: doorCalendarId, requestBody: doorEventDetails });
        } else {
             console.error(`Fatal: No door control calendar could be found or used for room ${roomId}.`);
        }
        
        return true;
    } catch (error: any) {
        // If event already exists (409), we can consider it a success for idempotency
        if (error.code === 409) {
            console.warn(`Event with ID ${id} already exists. Skipping creation.`);
            return true;
        }
        console.error('❌ Error creating Google Calendar event:', error);
        return false;
    }
}

export async function deleteGoogleCalendarEvent(eventId: string, roomId: '1' | '2'): Promise<boolean> {
     if (!hasGoogleConfig) {
        console.error("Cannot delete calendar event: Google Calendar API is not configured.");
        return false;
    }
    
    const sanitizedEventId = eventId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

    const calendarsToTry = [
        roomId === '1' ? CALENDAR_ID_ROOM_1 : CALENDAR_ID_ROOM_2,
        ...(roomId === '1' ? [CALENDAR_ID_DOOR_CONTROL_1A, CALENDAR_ID_DOOR_CONTROL_1B] : [CALENDAR_ID_DOOR_CONTROL_2A, CALENDAR_ID_DOOR_CONTROL_2B])
    ];

    let success = true;
    for (const calendarId of calendarsToTry) {
        if (!calendarId) continue;
        try {
            await calendar.events.delete({ calendarId, eventId: sanitizedEventId });
            console.log(`Successfully deleted event ${sanitizedEventId} from calendar ${calendarId}`);
        } catch (error: any) {
            if (error.code === 404) {
                console.log(`Event ${sanitizedEventId} not found in calendar ${calendarId}. Skipping.`);
            } else {
                console.error(`Error deleting event from ${calendarId}:`, error.message);
                success = false; // Mark as failed but continue trying other calendars
            }
        }
    }
    return success;
}
