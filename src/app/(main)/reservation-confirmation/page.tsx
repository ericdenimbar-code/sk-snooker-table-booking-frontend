
'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, Home, CalendarDays, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getRoomSettings } from '@/app/admin/settings/actions';
import type { ContactInfo } from '@/app/admin/settings/actions';

export default function ReservationConfirmationPage() {
  const searchParams = useSearchParams();
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchContactInfo() {
      try {
        const settings = await getRoomSettings('1');
        if (settings?.contactInfo) {
          setContactInfo(settings.contactInfo);
        }
      } catch (error) {
        console.error("Failed to fetch contact info:", error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchContactInfo();
  }, []);

  const roomId = searchParams.get('roomId');
  const date = searchParams.get('date');
  const startTime = searchParams.get('startTime');
  const endTime = searchParams.get('endTime');
  const ref = searchParams.get('ref');
  const roomName = searchParams.get('roomName');

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-4 sm:p-8 bg-background">
      <div className="w-full max-w-lg mx-auto">
        <Card className="text-center shadow-lg">
          <CardHeader className="items-center p-6">
            <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
            <CardTitle className="text-3xl">感謝您的預訂！</CardTitle>
            <CardDescription className="text-base text-muted-foreground pt-1">
              祝您有愉快的體驗。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-6 pb-8">
            <div className="border-t border-b py-6 space-y-2 text-foreground">
              <p className="text-lg">您已成功預約：</p>
              <p className="text-2xl font-bold text-primary">
                {roomName ? roomName.replace('房間', '枱號') : `枱號 ${roomId}`}
              </p>
              <p className="text-lg">
                {date}
              </p>
              <p className="text-lg font-semibold">
                {startTime} - {endTime}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">REFERENCE NUMBER</p>
              <p className="text-xl font-mono tracking-widest bg-muted rounded-md p-2 inline-block">
                {ref || 'N/A'}
              </p>
            </div>
            <div className="text-sm text-muted-foreground pt-4">
              <p>如有任何問題，可與我們聯絡：</p>
               {isLoading ? (
                 <div className="flex justify-center items-center h-10">
                    <Loader2 className="h-5 w-5 animate-spin" />
                 </div>
              ) : contactInfo ? (
                <>
                  <p>電話：{contactInfo.whatsapp}</p>
                  <p>電郵：{contactInfo.email}</p>
                </>
              ) : (
                <>
                  <p>電話：(852) 1234-5678</p>
                  <p>電郵：contact@roomreserva.com</p>
                </>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-4 pt-6">
              <Button asChild className="w-full" size="lg">
                <Link href="/new-reservation">
                  <Home className="mr-2" />
                  返回
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full" size="lg">
                <Link href="/reservations">
                  <CalendarDays className="mr-2" />
                  我的預訂清單
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
