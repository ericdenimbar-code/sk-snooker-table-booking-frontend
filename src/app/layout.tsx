
import type { Metadata } from 'next';
import { PT_Sans } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { cn } from '@/lib/utils';
import { getRoomSettings } from './admin/settings/actions';

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-sans',
});

export async function generateMetadata(): Promise<Metadata> {
  // This might return null if the backend isn't connected, so we handle that gracefully.
  const settings = await getRoomSettings('1');
  const siteName = settings?.siteBranding?.name || 'Snooker Kingdom Booking';

  return {
    title: {
      default: siteName,
      template: `%s | ${siteName}`,
    },
    description: '一個現代化的桌球室預訂系統。',
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className={cn("min-h-screen bg-background font-sans antialiased", ptSans.variable)}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
