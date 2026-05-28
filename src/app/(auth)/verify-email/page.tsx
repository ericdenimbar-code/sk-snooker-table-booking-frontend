'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, MailCheck, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ERROR_MESSAGES: Record<string, string> = {
    missing_token: '驗證連結缺少 token，請重新申請驗證郵件。',
    verification_failed: '驗證失敗，請重新申請驗證郵件。',
};

function VerifyEmailFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle>電子郵件驗證</CardTitle>
                    <CardDescription>完成帳戶啟用流程</CardDescription>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    <Loader2 className="h-14 w-14 animate-spin text-primary mx-auto" />
                    <p className="text-muted-foreground">正在處理驗證連結，請稍候...</p>
                </CardContent>
            </Card>
        </div>
    );
}

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const status = searchParams.get('status');
    const messageKey = searchParams.get('message');
    const legacyToken = searchParams.get('token');

    useEffect(() => {
        if (legacyToken && !status) {
            window.location.replace(
                `/api/verify-email?token=${encodeURIComponent(legacyToken)}`,
            );
        }
    }, [legacyToken, status]);

    if (legacyToken && !status) {
        return <VerifyEmailFallback />;
    }

    if (status === 'success') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle>電子郵件驗證</CardTitle>
                        <CardDescription>完成帳戶啟用流程</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center space-y-4">
                        <MailCheck className="h-14 w-14 text-green-500 mx-auto" />
                        <p className="text-muted-foreground">
                            電子郵件已成功驗證，你現在可以登入帳戶。
                        </p>
                        <Button asChild className="w-full">
                            <Link href="/login">前往登入</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (status === 'error') {
        const decodedMessage = messageKey ? decodeURIComponent(messageKey) : '';
        const displayMessage =
            (messageKey && ERROR_MESSAGES[messageKey]) ||
            decodedMessage ||
            ERROR_MESSAGES.verification_failed;

        return (
            <div className="min-h-screen flex items-center justify-center bg-background p-4">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle>電子郵件驗證</CardTitle>
                        <CardDescription>完成帳戶啟用流程</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center space-y-4">
                        <MailWarning className="h-14 w-14 text-amber-500 mx-auto" />
                        <p className="text-muted-foreground">{displayMessage}</p>
                        <Button asChild className="w-full">
                            <Link href="/login">前往登入</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle>電子郵件驗證</CardTitle>
                    <CardDescription>完成帳戶啟用流程</CardDescription>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    <MailWarning className="h-14 w-14 text-amber-500 mx-auto" />
                    <p className="text-muted-foreground">
                        請透過註冊郵件中的驗證連結開啟此頁面。
                    </p>
                    <Button asChild className="w-full">
                        <Link href="/login">前往登入</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={<VerifyEmailFallback />}>
            <VerifyEmailContent />
        </Suspense>
    );
}
