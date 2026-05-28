'use server';

import { auth } from '@/lib/firebase-admin';
import { sendCustomVerificationEmail, verifyEmailVerificationToken } from '@/lib/email';

type AuthActionResponse = {
    success: boolean;
    error?: string;
};

export async function sendSignupVerificationEmail(params: {
    uid: string;
    email: string;
    userName?: string;
}): Promise<AuthActionResponse> {
    const sent = await sendCustomVerificationEmail(params);
    if (!sent) {
        return { success: false, error: '驗證郵件發送失敗，請稍後再試。' };
    }
    return { success: true };
}

export async function verifySignupEmailToken(token: string): Promise<AuthActionResponse> {
    if (!auth) {
        return { success: false, error: '驗證服務暫時不可用。' };
    }

    try {
        const { uid, email } = await verifyEmailVerificationToken(token);
        const userRecord = await auth.getUser(uid);

        if (userRecord.email !== email) {
            return { success: false, error: '驗證連結與帳戶不符，請重新申請驗證郵件。' };
        }

        if (!userRecord.emailVerified) {
            await auth.updateUser(uid, { emailVerified: true });
        }

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : '驗證連結無效或已過期。';
        return { success: false, error: message };
    }
}
