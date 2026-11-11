import type { Metadata } from 'next';
import { ClosedoorClientPage } from './closedoor-client-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '離場關閉設施',
  description: '聚會完結離場前，請輸入 4 位密碼以啟動關閉設施程序。',
  robots: { index: false, follow: false },
};

export default function ClosedoorPage() {
  return <ClosedoorClientPage />;
}
