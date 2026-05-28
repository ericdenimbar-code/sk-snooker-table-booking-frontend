'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, MailCheck, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { verifySignupEmailToken } from '@/app/(auth)/actions';

type VerifyState = 'loading' | 'success' | 'error';

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
                    <p className="text-muted-foreground">正在驗證您的電子郵件，請稍候...</p>
                </CardContent>
            </Card>
        </div>
    );
}

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const [state, setState] = useState<VerifyState>('loading');
    const [message, setMessage] = useState('正在驗證您的電子郵件，請稍候...');

    useEffect(() => {
        let mounted = true;
        const token = searchParams.get('token');

        async function runVerification() {
            if (!token) {
                if (!mounted) return;
                setState('error');
                setMessage('驗證連結缺少 token，請重新申請驗證郵件。');
                return;
            }

            const result = await verifySignupEmailToken(token);
            if (!mounted) return;

            if (result.success) {
                setState('success');
                setMessage('電子郵件已成功驗證，你現在可以登入帳戶。');
            } else {
                setState('error');
                setMessage(result.error || '驗證失敗，請重新申請驗證郵件。');
            }
        }

        runVerification();
        return () => {
            mounted = false;
        };
    }, [searchParams]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <CardTitle>電子郵件驗證</CardTitle>
                    <CardDescription>完成帳戶啟用流程</CardDescription>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    {state === 'loading' && (
                        <Loader2 className="h-14 w-14 animate-spin text-primary mx-auto" />
                    )}
                    {state === 'success' && (
                        <MailCheck className="h-14 w-14 text-green-500 mx-auto" />
                    )}
                    {state === 'error' && (
                        <MailWarning className="h-14 w-14 text-amber-500 mx-auto" />
                    )}
                    <p className="text-muted-foreground">{message}</p>
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
