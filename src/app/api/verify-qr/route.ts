// This file is obsolete. The QR verification logic is now handled by a dedicated Cloud Function.
// It is kept temporarily to avoid breaking potential external calls, but it is no longer used by the application.
// You can safely delete this file in the future.

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json(
    { status: 'error', message: 'This API endpoint is deprecated. Please use the verifyQrCode Cloud Function.' },
    { status: 410 } // 410 Gone
  );
}
