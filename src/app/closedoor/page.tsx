import type { Metadata } from 'next';
import { ClosedoorClientPage } from './closedoor-client-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '離場關閉所有器材',
  description: '離場關閉所有器材',
  robots: { index: false, follow: false },
};

export default function ClosedoorPage() {
  return <ClosedoorClientPage />;
}
