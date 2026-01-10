
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { LogOut, CalendarDays, Building2, PlusCircle, ShoppingCart, ShieldAlert, Loader2, KeyRound } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useState, useEffect, useCallback } from 'react';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import type { User as AppUser } from '@/app/admin/users/actions';
import { useCart } from '@/hooks/use-cart'; 
import { Badge } from '@/components/ui/badge';
import { useRouter, usePathname } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { checkAndClearUserNotifications } from '@/app/admin/token-requests/actions';

function AccessControlWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const userDataString = localStorage.getItem('user');
      if (userDataString) {
        // Any logged-in user is authorized to see the main app section.
        setIsAuthorized(true);
      } else {
        // No user data found, redirect to login.
        router.replace('/login');
      }
    } catch (error) {
      console.error("Error verifying user access:", error);
      router.replace('/login');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">正在載入使用者資料...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
       <div className="flex h-[calc(100vh-4rem)] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 text-destructive">
            <ShieldAlert className="h-8 w-8" />
            <p className="font-semibold">需要登入</p>
            <p className="text-sm text-muted-foreground">正在將您重新導向至登入頁面...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}


function CartIcon() {
    const { cart } = useCart();
    const itemCount = cart.length;

    return (
        <Link href="/cart" passHref>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <ShoppingCart className="h-5 w-5 text-foreground z-10" />
                {itemCount > 0 && (
                    <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full p-1 text-xs z-20">
                        {itemCount}
                    </Badge>
                )}
                 <span className="sr-only">購物車</span>
            </Button>
        </Link>
    );
}


function UserNav() {
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    const updateUserState = () => {
        const userDataString = localStorage.getItem('user');
        if (userDataString) {
            try {
                const parsedUser = JSON.parse(userDataString);
                setUser(parsedUser);
            } catch (error) {
                console.error('Failed to parse user data from localStorage', error);
                localStorage.removeItem('user');
            }
        }
    };
    
    updateUserState(); 
    
    window.addEventListener('userUpdated', updateUserState);
    
    return () => {
        window.removeEventListener('userUpdated', updateUserState);
    };

  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // ONLY clear user-specific data. Keep the shopping cart.
      localStorage.removeItem('user');
      localStorage.removeItem('allUsers'); // Optional: can be cleared
      localStorage.removeItem('userReservations'); // Optional: can be cleared
      
      // Use assign to force a full reload, clearing any other state and redirecting
      window.location.assign('/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Even if signout fails, force a local cleanup and redirect
      localStorage.removeItem('user');
      localStorage.removeItem('allUsers');
      window.location.assign('/login');
    }
  };

  const menuItemClass = "flex w-full items-center cursor-pointer select-none rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="end">
        {user ? (
          <div className="p-2 font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{user.name}</p>
              <p className="text-xs leading-none text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
        ) : (
           <div className="p-2 font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">載入中...</p>
            </div>
          </div>
        )}
        <div className="my-1 h-px w-full shrink-0 bg-border" />
        <nav className="flex flex-col gap-1 p-1">
          {/* User-specific links */}
          {user?.role.toLowerCase() !== 'admin' && (
            <>
              <Link href="/new-reservation" className={menuItemClass}>
                <PlusCircle className="mr-2 h-4 w-4" />
                立即預訂
              </Link>
            </>
          )}

          <Link href="/account" className={menuItemClass}>帳戶資料</Link>
          
          {(user?.role.toLowerCase() === 'vvip' || user?.role.toLowerCase() === 'admin') && (
             <Link href="/temporary-access" className={menuItemClass}>
                <KeyRound className="mr-2 h-4 w-4" />
                臨時進出碼
             </Link>
          )}

          {user?.role.toLowerCase() !== 'admin' ? (
            <>
              <Link href="/reservations" className={menuItemClass}>我的預訂</Link>
              <Link href="/purchase-tokens" className={menuItemClass}>
                <span className="flex-grow">帳戶增值</span>
                {user?.tokens !== undefined && (
                  <span className="ml-2 text-xs font-normal text-primary">
                    （餘額：HKD {user.tokens}）
                  </span>
                )}
              </Link>
              <Link href="/contact-us" className={menuItemClass}>聯絡我們</Link>
            </>
          ) : (
            <div className={`${menuItemClass} pointer-events-none`}>
              <span className="flex-grow">帳戶增值</span>
              <span className="ml-2 text-xs font-normal text-primary">
                （餘額：∞）
              </span>
            </div>
          )}

          {/* Admin-specific link */}
          {user?.role.toLowerCase() === 'admin' && (
             <Link href="/admin" className={menuItemClass}>後台</Link>
          )}
        </nav>
        <div className="my-1 h-px w-full shrink-0 bg-border" />
        <div className="p-1">
           <div onClick={handleLogout} className={menuItemClass}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>登出</span>
           </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}


function MainHeader() {
  const [branding, setBranding] = useState<{ name: string; logoUrl: string } | null>(null);

  useEffect(() => {
    async function fetchBranding() {
      try {
        const settings = await getRoomSettings('1');
        if (settings && settings.siteBranding) {
          setBranding(settings.siteBranding);
        } else {
           setBranding({ name: 'Snooker Kingdom Booking', logoUrl: '' });
        }
      } catch (error) {
        console.error("Failed to fetch site branding:", error);
        setBranding({ name: 'Snooker Kingdom Booking', logoUrl: '' }); // Fallback on error
      }
    }
    fetchBranding();
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background">
      <div className="container flex h-16 items-center space-x-4 sm:justify-between sm:space-x-0">
        <div className="flex gap-6 md:gap-10">
          <Link href="/new-reservation" className="flex items-center space-x-2">
            {branding?.logoUrl ? (
                <img src={branding.logoUrl} alt="Logo" className="h-6 w-6 object-contain" />
            ) : (
                <Building2 className="h-6 w-6 text-primary" />
            )}
            <span className="inline-block font-bold text-primary">{branding?.name || 'Snooker Kingdom Booking'}</span>
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-end space-x-2">
          <CartIcon />
          <UserNav />
        </div>
      </div>
    </header>
  );
}

import { CartProvider } from '@/hooks/use-cart';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const { toast } = useToast();
    const pathname = usePathname();

    const checkForNotifications = useCallback(async () => {
        const userDataString = localStorage.getItem('user');
        if (userDataString) {
            try {
                const user: AppUser = JSON.parse(userDataString);
                if (user?.email) {
                    const result = await checkAndClearUserNotifications(user.email);
                    
                    if (result && result.notifications && result.notifications.length > 0) {
                        result.notifications.forEach(notification => {
                            toast({
                                title: notification.title,
                                description: notification.description,
                                duration: 10000,
                            });
                        });

                        if (result.user) {
                            // If the backend returned updated user data (with new token balance),
                            // update localStorage and dispatch an event to notify other components.
                            localStorage.setItem('user', JSON.stringify(result.user));
                            window.dispatchEvent(new Event('userUpdated'));
                        }
                    } else if (result && result.user && JSON.stringify(result.user) !== JSON.stringify(user)) {
                        // This handles cases where there's no notification, but user data
                        // (like tokens or role) has changed on the backend.
                        localStorage.setItem('user', JSON.stringify(result.user));
                        window.dispatchEvent(new Event('userUpdated'));
                    }
                }
            } catch (error) {
                console.error("Failed to check or process notifications:", error);
            }
        }
    }, [toast]);
    
    useEffect(() => {
        // This effect runs on initial mount and whenever the user navigates to a new page (pathname changes).
        checkForNotifications();
    }, [pathname, checkForNotifications]);


  return (
    <CartProvider>
        <div className="relative flex min-h-screen flex-col">
          <MainHeader />
          <AccessControlWrapper>
            <div className="flex-1">{children}</div>
          </AccessControlWrapper>
        </div>
    </CartProvider>
  );
}
