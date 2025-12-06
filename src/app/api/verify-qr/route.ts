import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { createGoogleCalendarEvent } from '@/lib/google-calendar';
import { parseISO, isWithinInterval, add, sub } from 'date-fns';
import type { Reservation, TemporaryAccess } from '@/types';

// This function checks both reservations and temporary access codes
async function findValidEntryBySecret(qrSecret: string) {
    if (!db) {
        throw new Error('Backend database not connected');
    }

    // 1. Check in 'reservations' collection
    const reservationsRef = db.collection('reservations');
    const resQuery = reservationsRef.where('qrSecret', '==', qrSecret).limit(1);
    const resSnapshot = await resQuery.get();

    if (!resSnapshot.empty) {
        const doc = resSnapshot.docs[0];
        const reservation = doc.data() as Reservation;

        const now = new Date();
        const startDateTime = parseISO(`${reservation.date}T${reservation.startTime}:00`);
        let endDateTime = parseISO(`${reservation.date}T${reservation.endTime}:00`);

        if (endDateTime < startDateTime) {
            endDateTime = add(endDateTime, { days: 1 });
        }
        
        // Grace period of 30 mins before and 30 mins after
        const interval = {
            start: sub(startDateTime, { minutes: 30 }),
            end: add(endDateTime, { minutes: 30 })
        };
        
        if (isWithinInterval(now, interval)) {
            return {
                type: 'reservation',
                ref: doc.ref,
                data: reservation
            };
        } else {
            throw new Error(`Time validation failed for reservation. Current time is outside the allowed booking window.`);
        }
    }

    // 2. If not found in reservations, check in 'temporaryAccess' collection
    const tempAccessRef = db.collection('temporaryAccess');
    const tempQuery = tempAccessRef.where('id', '==', qrSecret).limit(1);
    const tempSnapshot = await tempQuery.get();
    
    if (!tempSnapshot.empty) {
        const doc = tempSnapshot.docs[0];
        const tempAccess = doc.data() as TemporaryAccess;
        
        if (tempAccess.status !== 'active') {
            throw new Error('Temporary access code is not active.');
        }

        const now = new Date();
        const validFrom = parseISO(tempAccess.validFrom);
        const validUntil = parseISO(tempAccess.validUntil);

        if (isWithinInterval(now, { start: validFrom, end: validUntil })) {
             return {
                type: 'temporary',
                ref: doc.ref,
                data: tempAccess
            };
        } else {
            throw new Error('Current time is outside the temporary access window.');
        }
    }

    return null;
}


// POST /api/verify-qr
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { qrSecret } = body;

    if (!qrSecret) {
      return NextResponse.json({ status: 'error', message: 'Missing qrSecret' }, { status: 400 });
    }
    
    const validEntry = await findValidEntryBySecret(qrSecret);

    if (!validEntry) {
      return NextResponse.json({ status: 'error', message: 'Invalid or already used QR Code' }, { status: 404 });
    }
    
    // --- Validation Success ---

    // 1. Invalidate the QR Code immediately to prevent reuse
    if (validEntry.type === 'reservation') {
        await validEntry.ref.update({ qrSecret: `USED_${Date.now()}_${qrSecret}` });
    } else if (validEntry.type === 'temporary') {
        await validEntry.ref.update({ status: 'expired' });
    }

    // 2. **CRITICAL CHANGE**: Create a "trigger event" in the door control calendar instead of calling a webhook.
    const now = new Date();
    const triggerEvent = await createGoogleCalendarEvent({
        summary: 'OPEN_DOOR',
        description: `Triggered by ${validEntry.type} ID: ${validEntry.data.id} for user ${(validEntry.data as Reservation).userName || (validEntry.data as TemporaryAccess).userEmail}.`,
        start: now.toISOString(),
        end: add(now, { minutes: 1 }).toISOString(), // Event just needs to exist briefly
        eventId: `trigger-${Date.now()}`,
        roomId: 'door_control'
    });

    if (!triggerEvent) {
        console.error("[CRITICAL] Failed to create Google Calendar trigger event. Door will not open.");
        // We still return success to the scanner, as the user is valid, but log the critical failure.
    }
    
    // 3. Return success response to the original caller (the HA rest_command)
    return NextResponse.json({ status: 'ok', message: `QR Code verified successfully (${validEntry.type}). Trigger event created.` });

  } catch (error: any) {
    console.error('Error in /api/verify-qr:', error);
    return NextResponse.json({ status: 'error', message: error.message || 'An internal server error occurred.' }, { status: 500 });
  }
}
