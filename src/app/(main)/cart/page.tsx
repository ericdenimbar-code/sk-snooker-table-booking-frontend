'use client';

import { useState, useEffect, useMemo } from 'react';
import { useCart, type CartItem } from '@/hooks/use-cart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Trash2, Loader2, AlertTriangle, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getAllReservations, createMultipleReservations } from '../new-reservation/actions';
import { getUserByEmail, adjustUserTokens } from '@/app/admin/users/actions';
import type { Reservation } from '@/types';
import { isBefore, parse } from 'date-fns';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

type AppUser = {
  id: string; 
  name: string;
  email:string;
  phone?: string;
  role: 'admin' | 'user' | 'Admin' | 'User' | 'VIP';
  tokens?: number;
};

type ValidatedCartItem = CartItem & {
  isValid: boolean;
  validationMessage: string;
};

export default function CartPage() {
  const { cart, removeFromCart, clearCart } = useCart();
  const { toast } = useToast();
  const router = useRouter();

  const [validatedCart, setValidatedCart] = useState<ValidatedCartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
        const userDataString = localStorage.getItem('user');
        if (userDataString) {
            try {
                setUser(JSON.parse(userDataString));
            } catch (e) { console.error("Failed to parse user data", e); }
        }
    }
    fetchUser();

    const validateCartItems = async () => {
      setIsLoading(true);
      if (cart.length === 0) {
        setValidatedCart([]);
        setIsLoading(false);
        return;
      }
      
      const reservationResult = await getAllReservations();
      const now = new Date();

      if (reservationResult.success && reservationResult.reservations) {
        const allReservations: Reservation[] = reservationResult.reservations;
        
        const validatedItems = cart.map(item => {
          let isValid = true;
          let validationMessage = '';

          // Check if time has passed
          const itemStartDateTime = parse(`${item.date} ${item.startTime}`, 'yyyy-MM-dd HH:mm', new Date());
          if (isBefore(itemStartDateTime, now)) {
            isValid = false;
            validationMessage = '該時段已過期';
          }

          // Check for booking conflicts
          if (isValid) {
            const bookingsInSlot = allReservations.filter(res => 
              res.status !== 'Cancelled' &&
              res.date === item.date &&
              res.startTime < item.endTime &&
              res.endTime > item.startTime
            );

            const room1Bookings = bookingsInSlot.filter(b => b.roomId === '1').length;
            const room2Bookings = bookingsInSlot.filter(b => b.roomId === '2').length;
            
            if (item.roomId === '1' && room1Bookings > 0) {
                 isValid = false;
                 validationMessage = '該時段已被預訂';
            } else if(item.roomId === '2' && room2Bookings > 0) {
                 isValid = false;
                 validationMessage = '該時段已被預訂';
            } else if (room1Bookings > 0 && room2Bookings > 0) {
                isValid = false;
                validationMessage = '該時段名額已滿';
            }
          }
          
          return { ...item, isValid, validationMessage };
        });
        setValidatedCart(validatedItems);
      } else {
        // If we can't fetch reservations, assume all items are valid but show a warning
        toast({ variant: 'destructive', title: '驗證失敗', description: '無法驗證購物車時段的有效性，請謹慎結算。' });
        setValidatedCart(cart.map(item => ({ ...item, isValid: true, validationMessage: '無法驗證' })));
      }
      setIsLoading(false);
    };

    validateCartItems();
  }, [cart, toast]);

  const totalCost = useMemo(() => {
    return validatedCart.reduce((acc, item) => (item.isValid ? acc + item.cost : acc), 0);
  }, [validatedCart]);

  const handleCheckout = async () => {
    setIsCheckingOut(true);
    
    if (!user || user.tokens === undefined) {
      toast({ variant: 'destructive', title: '無法結算', description: '請重新登入後再試。' });
      setIsCheckingOut(false);
      return;
    }
    
    const validItems = validatedCart.filter(item => item.isValid);
    if (validItems.length === 0) {
      toast({ variant: 'destructive', title: '沒有可結算的項目', description: '您的購物車中沒有有效的預約時段。' });
      setIsCheckingOut(false);
      return;
    }
    
    if (user.tokens < totalCost) {
      toast({ variant: 'destructive', title: '餘額不足', description: `您需要 HKD ${totalCost.toFixed(2)}，但目前只有 HKD ${user.tokens.toFixed(2)}。` });
      setIsCheckingOut(false);
      return;
    }

    const reservationData = validItems.map(item => ({
        roomId: item.roomId,
        roomName: item.roomName,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.phone || '',
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        hours: item.duration,
        costInTokens: item.cost,
        isSoloPractice: item.isSolo,
        status: 'Confirmed' as const,
        paymentMethod: 'tokens' as const,
    }));

    const result = await createMultipleReservations(reservationData, user.id, totalCost);

    if (result.success && result.createdReservations) {
        clearCart();
        
        // Update user balance in localStorage
        const newTokens = (user.tokens ?? 0) - totalCost;
        const updatedUser = { ...user, tokens: newTokens };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('userUpdated'));
        
        toast({ title: '結算成功！', description: `${result.createdReservations.length} 個預約已確認。` });
        
        // For simplicity, redirecting to the main reservations page.
        // A more advanced confirmation page could be built here.
        router.push('/reservations');
    } else {
        toast({ variant: 'destructive', title: '結算失敗', description: result.error || '發生未知錯誤，部分或全部時段可能已被預訂。' });
    }

    setIsCheckingOut(false);
  };


  const CartItemCard = ({ item }: { item: ValidatedCartItem }) => (
    <Card className={cn("relative overflow-hidden", !item.isValid && "bg-muted/50")}>
        {!item.isValid && (
            <div className="absolute inset-0 bg-slate-600/70 z-10 flex items-center justify-center">
                <p className="text-white font-bold text-lg flex items-center gap-2"><AlertTriangle /> {item.validationMessage}</p>
            </div>
        )}
      <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 space-y-2">
            <div className="font-bold text-lg">{item.roomName.replace('房間', '枱號')}</div>
            <div className="text-muted-foreground">{item.date}</div>
            <div className="text-xl font-semibold text-primary">{item.startTime} - {item.endTime}</div>
            <div className="text-xs text-muted-foreground">{item.duration} 小時 {item.isSolo ? ' (一人練波)' : ''}</div>
        </div>
        <div className="flex sm:flex-col justify-between items-end sm:items-end w-full sm:w-auto">
            <div className="text-right">
                <p className={cn("text-2xl font-bold", !item.isValid && "line-through text-muted-foreground")}>HKD ${item.cost.toFixed(2)}</p>
                {item.isVip && <p className="text-xs text-blue-600">已套用會員折扣</p>}
            </div>
            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive/80" onClick={() => removeFromCart(item.id)}>
                <Trash2 className="h-5 w-5"/>
                <span className="sr-only">移除</span>
            </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="flex flex-1 flex-col items-center p-4 sm:p-8">
      <div className="w-full max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <ShoppingCart />
              我的購物車
            </CardTitle>
            <CardDescription>請檢查您的預約時段，然後進行結算。</CardDescription>
          </CardHeader>
        </Card>
        
        {isLoading ? (
            <div className="text-center py-10"><Loader2 className="h-8 w-8 animate-spin mx-auto"/></div>
        ) : cart.length === 0 ? (
            <Card>
                <CardContent className="pt-6">
                    <div className="text-center py-10 text-muted-foreground">
                        <ShoppingCart className="h-12 w-12 mx-auto mb-4"/>
                        <p>您的購物車是空的。</p>
                    </div>
                </CardContent>
            </Card>
        ) : (
            <>
                <div className="space-y-4">
                    {validatedCart.map(item => <CartItemCard key={item.id} item={item} />)}
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>結算總額</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex justify-between items-baseline">
                            <span className="text-muted-foreground">有效項目總額</span>
                            <span className="text-2xl font-bold text-primary">HKD ${totalCost.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                            <span className="text-muted-foreground">目前帳戶餘額</span>
                            <span className="font-semibold">HKD ${user?.tokens?.toFixed(2) ?? '0.00'}</span>
                        </div>
                         {user && user.tokens !== undefined && user.tokens < totalCost && (
                            <p className="text-sm text-destructive text-right">您的餘額不足，請先增值。</p>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button 
                            className="w-full" 
                            size="lg" 
                            onClick={handleCheckout}
                            disabled={isCheckingOut || totalCost === 0 || (user?.tokens ?? 0) < totalCost}
                        >
                            {isCheckingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            使用帳戶餘額結算
                        </Button>
                    </CardFooter>
                </Card>
            </>
        )}
      </div>
    </main>
  );
}
