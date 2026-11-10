import type { Metadata } from 'next';
import { ClosedoorClientPage } from './closedoor-client-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '結束預留時段',
  description: '輸入預留時段密碼，結束該段並開放餘下時間',
  robots: { index: false, follow: false },
};

export default function ClosedoorPage() {
  return <ClosedoorClientPage />;
}
