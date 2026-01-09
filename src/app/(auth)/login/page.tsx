
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, EyeOff, Building2, MailWarning } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getUserByEmail } from '@/app/admin/users/actions';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";


const loginSchema = z.object({
  email: z.string().email({ message: '無效的電子郵件地址。' }),
  password: z.string().min(1, { message: '密碼為必填項。' }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const [siteName, setSiteName] = useState('Snooker Kingdom Booking');
  
  const [isVerificationAlertOpen, setIsVerificationAlertOpen] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState('');

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

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const handleResendVerification = async (email: string) => {
    try {
        if (auth.currentUser && auth.currentUser.email === email && !auth.currentUser.emailVerified) {
            await sendEmailVerification(auth.currentUser);
        }
    } catch (error: any) {
        console.error("Could not get user object to resend verification email on subsequent attempts.", error);
    }
  }


  async function onSubmit(values: LoginFormValues) {
    setIsLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, values.email, values.password);
      
      if (!userCredential.user.emailVerified) {
          await sendEmailVerification(userCredential.user);
          setEmailForVerification(values.email);
          setIsVerificationAlertOpen(true);
          setIsLoading(false);
          return;
      }
      
      const userProfile = await getUserByEmail(values.email);

      if (userProfile) {
          localStorage.setItem('user', JSON.stringify(userProfile));
          window.dispatchEvent(new Event('userUpdated')); // Dispatch event on login
          
          if (userProfile.role.toLowerCase() === 'admin') {
              window.location.assign('/admin');
          } else {
              window.location.assign('/new-reservation');
          }
      } else {
          throw new Error('找不到您的使用者設定檔，請聯絡管理員。');
      }

    } catch (error: any) {
        let title = '登入失敗';
        let description = '您輸入的電子郵件或密碼不正確。';
        
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            description = '您輸入的電子郵件或密碼不正確。'
        } else if (error.message) {
            description = error.message;
        }

        toast({
            variant: 'destructive',
            title: title,
            description: description,
        });
    } finally {
        setIsLoading(false);
    }
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center items-center mb-4">
               <Building2 className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>登入 {siteName}</CardTitle>
            <CardDescription>
              歡迎回來，請登入您的帳戶。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>電子郵件</FormLabel>
                      <FormControl>
                        <Input placeholder="name@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>密碼</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="password"
                            className="pr-10"
                            {...field}
                          />
                        </FormControl>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
                          aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                        >
                          {showPassword ? (
                            <EyeOff className="h-5 w-5" />
                          ) : (
                            <Eye className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  登入
                </Button>
              </form>
            </Form>
            <div className="mt-4 text-center text-sm">
              還沒有帳戶嗎？{' '}
              <Link href="/signup" className="underline">
                註冊
              </Link>
            </div>
            <div className="mt-2 text-center text-sm">
              <Link href="/forgot-password" className="underline text-muted-foreground hover:text-primary">
                忘記密碼？請按此
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={isVerificationAlertOpen} onOpenChange={setIsVerificationAlertOpen}>
          <AlertDialogContent>
              <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <MailWarning className="h-6 w-6 text-amber-500" />
                    請先驗證您的電子郵件
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                      您的帳戶尚未啟用。我們已重新發送了一封驗證郵件到 <span className="font-semibold text-primary">{emailForVerification}</span>。
                      <br /><br />
                      請檢查您的收件箱（以及垃圾郵件匣），並點擊郵件中的連結以完成註冊。
                  </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                  <AlertDialogAction onClick={() => setIsVerificationAlertOpen(false)}>明白</AlertDialogAction>
              </AlertDialogFooter>
          </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

    