import { NextResponse } from 'next/server';
import { verifySignupEmailToken } from '@/app/(auth)/actions';

function getAppBaseUrl(): string {
    return (
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_BASE_URL ||
        'http://localhost:3000'
    );
}

export async function GET(request: Request) {
    const baseUrl = getAppBaseUrl();
    const { searchParams } = new URL(request.url);
    const rawToken = searchParams.get('token');

    if (!rawToken) {
        return NextResponse.redirect(
            new URL('/verify-email?status=error&message=missing_token', baseUrl),
        );
    }

    const token = decodeURIComponent(rawToken);
    const result = await verifySignupEmailToken(token);

    if (result.success) {
        return NextResponse.redirect(new URL('/verify-email?status=success', baseUrl));
    }

    const message = encodeURIComponent(result.error || 'verification_failed');
    return NextResponse.redirect(
        new URL(`/verify-email?status=error&message=${message}`, baseUrl),
    );
}
