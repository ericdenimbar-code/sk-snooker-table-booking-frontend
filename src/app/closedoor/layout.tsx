import { Building2 } from 'lucide-react';
import { getPublicSiteName } from './actions';

export default async function ClosedoorLayout({ children }: { children: React.ReactNode }) {
  const siteName = await getPublicSiteName();

  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 w-full border-b bg-background">
        <div className="container flex h-16 items-center">
          <div className="flex items-center space-x-2">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="inline-block font-bold text-primary">{siteName}</span>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
