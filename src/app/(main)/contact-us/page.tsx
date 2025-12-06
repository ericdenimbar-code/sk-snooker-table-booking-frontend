
'use server';

import { getRoomSettings } from '@/app/admin/settings/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Mail, Terminal, User, Phone, MapPin, Info, Network } from 'lucide-react';
import { db } from '@/lib/firebase-admin';
import Link from 'next/link';

// Reusable component for info rows
const InfoRow = ({ icon, label, children }: { icon: React.ReactNode, label: string, children: React.ReactNode }) => (
    <div className="flex items-start py-4 border-b last:border-none">
      <div className="flex-shrink-0 w-8 text-center text-muted-foreground">{icon}</div>
      <div className="flex-1 pl-4">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="mt-1 text-base">{children}</div>
      </div>
    </div>
);


export default async function ContactUsPage() {
    // Explicitly check for DB connection first for a clearer error message.
    if (!db) {
        return (
            <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
                 <Alert variant="destructive" className="w-full max-w-2xl">
                    <Network className="h-4 w-4" />
                    <AlertTitle>後端連線錯誤</AlertTitle>
                    <AlertDescription>
                        很抱歉，系統目前無法連接至後端資料庫，因此無法載入「聯絡我們」的頁面內容。
                        請檢查您的伺服器設定或稍後再試。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }
    
    // We fetch settings from room '1' as it contains the global site settings
    const settings = await getRoomSettings('1');

    if (!settings) {
        return (
            <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
                <Alert variant="destructive" className="w-full max-w-2xl">
                    <Terminal className="h-4 w-4" />
                    <AlertTitle>無法載入頁面內容</AlertTitle>
                    <AlertDescription>
                        無法從資料庫中找到頁面設定。請聯絡管理員以解決此問題。
                    </AlertDescription>
                </Alert>
            </main>
        )
    }

    const { contactInfo } = settings;

    // A small helper to clean up the phone number for the WhatsApp link
    const whatsappLink = `https://wa.me/${contactInfo.whatsapp.replace(/\D/g, '')}`;

    return (
        <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
            <div className="w-full max-w-2xl">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-3">
                            <Mail className="h-6 w-6 text-primary" />
                            聯絡我們
                        </CardTitle>
                        <CardDescription>我們樂意為您提供協助。</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="divide-y">
                            {contactInfo.name && (
                                <InfoRow icon={<User className="h-5 w-5" />} label="聯絡人">
                                    <p>{contactInfo.name}</p>
                                </InfoRow>
                            )}
                            {contactInfo.email && (
                                <InfoRow icon={<Mail className="h-5 w-5" />} label="電郵地址">
                                    <a href={`mailto:${contactInfo.email}`} className="text-primary hover:underline">
                                        {contactInfo.email}
                                    </a>
                                </InfoRow>
                            )}
                            {contactInfo.whatsapp && (
                                <InfoRow icon={<Phone className="h-5 w-5" />} label="WhatsApp">
                                     <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                        {contactInfo.whatsapp}
                                    </a>
                                </InfoRow>
                            )}
                             {contactInfo.address && (
                                <InfoRow icon={<MapPin className="h-5 w-5" />} label="地址">
                                    <p>{contactInfo.address}</p>
                                </InfoRow>
                            )}
                        </div>
                    </CardContent>
                    {contactInfo.additionalInfo && (
                        <>
                            <div className="mx-6 border-t" />
                            <CardContent className="pt-6">
                                <div className="space-y-2">
                                    <h3 className="font-semibold flex items-center gap-2 text-base">
                                        <Info className="h-5 w-5 text-primary" />
                                        額外資訊
                                    </h3>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                        {contactInfo.additionalInfo}
                                    </p>
                                </div>
                            </CardContent>
                        </>
                    )}
                </Card>
            </div>
        </main>
    );
}
