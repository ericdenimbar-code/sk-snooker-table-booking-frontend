
'use client'

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home,
  Users,
  CalendarCheck,
  Coins,
  LogOut,
  Globe,
  Network,
  Menu,
  ClipboardList,
  Building2,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { getRoomSettings } from './settings/actions';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';

type StoredUser = {
  name: string;
  email: string;
  role: 'Admin' | 'User' | 'VIP';
};

// Pass a function to close the sheet as a prop
function AdminNav({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();
  const linkClass = "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary";
  const activeLinkClass = "bg-muted text-primary";

  // Use startsWith for active links to highlight parent routes
  const isActive = (path: string) => pathname.startsWith(path);

  // Wrapper function to handle both navigation and closing the sheet
  const handleClick = () => {
    if (onLinkClick) {
      onLinkClick();
    }
  };

  return (
    <nav className="grid items-start px-2 text-sm font-medium lg:px-4">
      <Link
        href="/admin"
        className={cn(linkClass, pathname === '/admin' && activeLinkClass)}
        onClick={handleClick}
      >
        <Home className="h-4 w-4" />
        儀表板
      </Link>
      <Link
        href="/admin/bookings"
        className={cn(linkClass, isActive('/admin/bookings') && activeLinkClass)}
        onClick={handleClick}
      >
        <CalendarCheck className="h-4 w-4" />
        預訂管理
      </Link>
      <Link
        href="/admin/users"
        className={cn(linkClass, isActive('/admin/users') && activeLinkClass)}
        onClick={handleClick}
      >
        <Users className="h-4 w-4" />
        使用者管理
      </Link>
      <Link
        href="/admin/token-requests"
        className={cn(linkClass, isActive('/admin/token-requests') && activeLinkClass)}
        onClick={handleClick}
      >
        <ClipboardList className="h-4 w-4" />
        增值審批
      </Link>
      <Link
        href="/admin/settings"
        className={cn(linkClass, isActive('/admin/settings') && activeLinkClass)}
        onClick={handleClick}
      >
        <Coins className="h-4 w-4" />
        價目及內容設定
      </Link>
      <Link
        href="/admin/status"
        className={cn(linkClass, isActive('/admin/status') && activeLinkClass)}
        onClick={handleClick}
      >
        <Network className="h-4 w-4" />
        連線狀態
      </Link>
      <div className="my-2 border-t border-muted" />
      <Link
        href="/new-reservation"
        className={linkClass}
        onClick={handleClick}
      >
        <Globe className="h-4 w-4" />
        返回前台
      </Link>
    </nav>
  );
}


function AdminHeader({ siteName }: { siteName: string }) {
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false); // State to control the Sheet

  useEffect(() => {
    // This code runs only on the client-side
    const userDataString = localStorage.getItem('user');
    if (userDataString) {
      try {
        const parsedUser: StoredUser = JSON.parse(userDataString);
        setCurrentUser(parsedUser);
      } catch (error) {
        console.error('Failed to parse admin data from localStorage', error);
      }
    }
  }, []);

  const handleAdminLogout = async () => {
    try {
        await signOut(auth);
        // Clear all session-related data from localStorage
        localStorage.removeItem('user');
        localStorage.removeItem('allUsers');
        localStorage.removeItem('userReservations');
        // Use assign to force a full reload, clearing any other state and redirecting
        window.location.assign('/login');
    } catch (error) {
        console.error('Logout error:', error);
        // Even if signout fails, force a local cleanup and redirect
        localStorage.clear();
        window.location.assign('/login');
    }
  };

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0 md:hidden"
                >
                    <Menu className="h-5 w-5" />
                    <span className="sr-only">Toggle navigation menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
                <div className="flex h-14 items-center border-b px-4">
                    <Link href="/admin" className="flex items-center gap-2 font-semibold" onClick={() => setIsSheetOpen(false)}>
                        <Building2 className="h-6 w-6 text-primary" />
                        <span>{siteName} 後台</span>
                    </Link>
                </div>
                <div className="flex-1 overflow-y-auto py-4">
                  <AdminNav onLinkClick={() => setIsSheetOpen(false)} />
                </div>
            </SheetContent>
        </Sheet>
        <div className="w-full flex-1">
          {/* This space can be used for a search bar or other header elements in the future */}
        </div>
        <div className="flex items-center gap-4">
            <Avatar className="h-8 w-8">
              <AvatarImage src="https://placehold.co/40x40.png" alt="@admin" data-ai-hint="admin avatar" />
              <AvatarFallback>{currentUser?.name?.charAt(0).toUpperCase() || 'A'}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium leading-none">{currentUser?.name || '管理員'}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {currentUser?.email || '載入中...'}
              </p>
            </div>
             <Button variant="ghost" size="sm" onClick={handleAdminLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                登出
             </Button>
        </div>
    </header>
  )
}

function AccessControlWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const userDataString = localStorage.getItem('user');
      if (userDataString) {
        const user: StoredUser = JSON.parse(userDataString);
        // Case-insensitive check for 'Admin' role
        if (user && user.role && user.role.toLowerCase() === 'admin') {
          setIsAuthorized(true);
        } else {
          // User is logged in but not an admin
          router.replace('/login');
        }
      } else {
        // No user data found
        router.replace('/login');
      }
    } catch (error) {
      console.error("Error verifying admin access:", error);
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">正在驗證權限...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    // This will show a brief message before the redirect completes.
    return (
       <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 text-destructive">
            <ShieldAlert className="h-8 w-8" />
            <p className="font-semibold">權限不足</p>
            <p className="text-sm text-muted-foreground">正在將您重新導向至登入頁面...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}


export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [siteName, setSiteName] = useState('Snooker Kingdom Booking');

  useEffect(() => {
    async function fetchSiteName() {
      try {
        const settings = await getRoomSettings('1');
        if (settings?.siteBranding?.name) {
          setSiteName(settings.siteBranding.name);
        }
      } catch (error) {
        console.error("Failed to fetch site name:", error);
      }
    }
    fetchSiteName();
  }, []);

  return (
    <AccessControlWrapper>
        <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
          <div className="hidden border-r bg-muted/40 md:block">
            <div className="flex h-full max-h-screen flex-col gap-2">
              <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
                <Link href="/admin" className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-6 w-6 text-primary" />
                  <span className="">{siteName} 後台</span>
                </Link>
              </div>
              <div className="flex-1">
                <AdminNav />
              </div>
            </div>
          </div>
          <div className="flex flex-col h-screen">
            <AdminHeader siteName={siteName} />
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-auto">
                {children}
            </main>
          </div>
        </div>
    </AccessControlWrapper>
  );
}
