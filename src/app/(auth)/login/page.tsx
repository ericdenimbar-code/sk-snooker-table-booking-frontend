
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Loader2, Eye, EyeOff, Building2, Mail, Lock, MailWarning } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getUserByEmail } from '@/app/admin/users/actions';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { sendSignupVerificationEmail } from '@/app/(auth)/actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { cn } from '@/lib/utils';

const DEFAULT_LOGIN_BACKGROUND = '/images/login-background.png';

const loginSchema = z.object({
  email: z.string().email({ message: '無效的電子郵件地址。' }),
  password: z.string().min(1, { message: '密碼為必填項。' }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const inputClassName =
  'w-full rounded-full border border-white/10 bg-white/10 py-3.5 pl-14 pr-12 text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-white/25 transition-shadow';

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();
  const [branding, setBranding] = useState<{
    name: string;
    logoUrl: string;
    loginBackgroundUrl: string;
  }>({
    name: 'Snooker Kingdom Booking',
    logoUrl: '',
    loginBackgroundUrl: '',
  });

  const [isVerificationAlertOpen, setIsVerificationAlertOpen] = useState(false);
  const [emailForVerification, setEmailForVerification] = useState('');

  useEffect(() => {
    async function fetchBranding() {
      try {
        const settings = await getRoomSettings('1');
        if (settings?.siteBranding) {
          setBranding({
            name: settings.siteBranding.name || 'Snooker Kingdom Booking',
            logoUrl: settings.siteBranding.logoUrl || '',
            loginBackgroundUrl: settings.siteBranding.loginBackgroundUrl || '',
          });
        }
      } catch (error) {
        console.error('Failed to fetch site branding:', error);
      }
    }
    fetchBranding();
  }, []);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const backgroundUrl = branding.loginBackgroundUrl || DEFAULT_LOGIN_BACKGROUND;

  async function onSubmit(values: LoginFormValues) {
    setIsLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        values.email,
        values.password
      );

      if (!userCredential.user.emailVerified) {
        await sendSignupVerificationEmail({
          uid: userCredential.user.uid,
          email: values.email,
        });
        await signOut(auth);
        setEmailForVerification(values.email);
        setIsVerificationAlertOpen(true);
        setIsLoading(false);
        return;
      }

      const userProfile = await getUserByEmail(values.email);

      if (userProfile) {
        localStorage.setItem('user', JSON.stringify(userProfile));

        if (userProfile.role.toLowerCase() === 'admin') {
          window.location.assign('/admin/bookings');
        } else {
          window.location.assign('/new-reservation');
        }
      } else {
        throw new Error('找不到您的使用者設定檔，請聯絡管理員。');
      }
    } catch (error: unknown) {
      const authError = error as { code?: string; message?: string };
      let title = '登入失敗';
      let description = '您輸入的電子郵件或密碼不正確。';

      if (authError.message) {
        description = authError.message;
      }

      toast({
        variant: 'destructive',
        title,
        description,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <div className="relative min-h-screen flex items-center justify-center overflow-hidden p-4 sm:p-6">
        <div
          className="absolute inset-0 bg-cover bg-center scale-105"
          style={{ backgroundImage: `url(${backgroundUrl})` }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-hidden />

        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <div className="relative z-20 -mb-12 flex justify-center">
            {branding.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt="Logo"
                className="h-24 w-24 rounded-full border-2 border-white/20 object-contain shadow-lg shadow-black/50"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-white/20 bg-black/60 shadow-lg shadow-black/50">
                <Building2 className="h-10 w-10 text-white/80" />
              </div>
            )}
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-black/40 px-6 pb-8 pt-16 backdrop-blur-md sm:px-8">
            <h1 className="text-center text-[1.5rem] font-bold uppercase leading-8 tracking-wide text-white sm:text-[1.8rem] sm:leading-[2rem]">
              {branding.name}
            </h1>
            <p className="mt-2 text-center text-sm text-gray-300">
              歡迎回來，請登入您的帳戶。
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mt-8 space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50">
                            <Mail className="h-4 w-4 text-gray-300" />
                          </span>
                          <input
                            type="email"
                            placeholder="電子郵件"
                            className={inputClassName}
                            autoComplete="email"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-center text-xs text-red-300" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50">
                            <Lock className="h-4 w-4 text-gray-300" />
                          </span>
                          <input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="密碼"
                            className={inputClassName}
                            autoComplete="current-password"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-white"
                            aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                          >
                            {showPassword ? (
                              <EyeOff className="h-5 w-5" />
                            ) : (
                              <Eye className="h-5 w-5" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage className="text-center text-xs text-red-300" />
                    </FormItem>
                  )}
                />

                <button
                  type="submit"
                  disabled={isLoading}
                  className={cn(
                    'mt-2 flex w-full items-center justify-center rounded-full py-3.5 text-sm font-bold text-gray-800 transition-colors',
                    'bg-[#c4c0d0] hover:bg-[#d4d0e0] disabled:cursor-not-allowed disabled:opacity-70'
                  )}
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  登入
                </button>
              </form>
            </Form>

            <p className="mt-5 text-center text-sm text-gray-300">
              還沒有帳戶嗎？{' '}
              <Link
                href="/signup"
                className="text-white underline underline-offset-2 hover:text-gray-200"
              >
                註冊
              </Link>
            </p>

            <p className="mt-4 text-center">
              <Link
                href="/forgot-password"
                className="text-sm italic text-white/90 underline-offset-2 transition-colors hover:text-white hover:underline"
              >
                忘記密碼？
              </Link>
            </p>
          </div>
        </div>
      </div>

      <AlertDialog
        open={isVerificationAlertOpen}
        onOpenChange={setIsVerificationAlertOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MailWarning className="h-6 w-6 text-amber-500" />
              請先驗證您的電子郵件
            </AlertDialogTitle>
            <AlertDialogDescription>
              您的帳戶尚未啟用。我們已重新發送了一封驗證郵件到{' '}
              <span className="font-semibold text-primary">
                {emailForVerification}
              </span>
              。
              <br />
              <br />
              請檢查您的收件箱（以及垃圾郵件匣），並點擊郵件中的連結以完成註冊。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setIsVerificationAlertOpen(false)}
            >
              明白
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
