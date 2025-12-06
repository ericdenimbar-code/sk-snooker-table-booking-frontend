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
import { Loader2, Eye, EyeOff, MailCheck, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { auth } from '@/lib/firebase';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { createUserInFirestore } from '@/app/admin/users/actions';
import { useRouter } from 'next/navigation';

const signupSchema = z.object({
  name: z.string().min(2, { message: '姓名至少需要 2 個字元。' }),
  phone: z.string().min(8, { message: '電話號碼至少需要 8 個數字。' }),
  email: z.string().email({ message: '無效的電子郵件地址。' }),
  password: z.string().min(8, { message: '密碼至少需要 8 個字元。' }),
});

type SignupFormValues = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const { toast } = useToast();
  const router = useRouter();
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
  
  useEffect(() => {
    if (isSubmitted) {
      const timer = setTimeout(() => {
        router.push('/login');
      }, 15000); // 15 seconds

      return () => clearTimeout(timer); // Cleanup timer on component unmount
    }
  }, [isSubmitted, router]);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: SignupFormValues) {
    setIsLoading(true);
    
    try {
      // 1. Create user in Firebase Authentication
      const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      // 2. Send verification email
      await sendEmailVerification(user);

      // 3. Create corresponding user document in Firestore
      const result = await createUserInFirestore({
        id: user.uid,
        email: values.email,
        name: values.name,
        phone: values.phone,
      });

      if (result.success) {
        setSubmittedEmail(values.email);
        setIsSubmitted(true);
      } else {
        throw new Error(result.error || "無法在資料庫中建立使用者資料。");
      }

    } catch (error: any) {
      let title = '註冊失敗';
      let description = '發生未知錯誤，請稍後再試。';

      if (error.code === 'auth/email-already-in-use') {
        title = '電郵已被使用';
        description = '這個電子郵件地址已經被註冊了，請嘗試登入或使用其他電郵。';
      } else if (error.code === 'auth/weak-password') {
        title = '密碼強度不足';
        description = '密碼至少需要 8 個字元。';
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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
           <div className="flex justify-center items-center mb-4">
             <Building2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>{isSubmitted ? "驗證郵件已發送" : "建立帳戶"}</CardTitle>
          <CardDescription>
            {isSubmitted 
              ? "請檢查您的電子郵件收件箱以完成註冊。"
              : `輸入您的詳細資訊以開始使用 ${siteName}。`
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSubmitted ? (
            <div className="text-center space-y-4">
                <MailCheck className="h-16 w-16 text-green-500 mx-auto" />
                <p className="text-muted-foreground">
                    我們已向 <span className="font-semibold text-primary">{submittedEmail}</span> 發送了一封驗證郵件。請點擊郵件中的連結以啟用您的帳戶。
                </p>
                <p className="text-xs text-muted-foreground">
                    如果找不到郵件，請檢查您的垃圾郵件匣。頁面將在 15 秒後自動跳轉到登入頁。
                </p>
                <Button asChild className="w-full">
                    <Link href="/login">立即返回登入</Link>
                </Button>
            </div>
          ) : (
            <>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>姓名</FormLabel>
                        <FormControl>
                          <Input placeholder="陳大文" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>電話號碼</FormLabel>
                        <FormControl>
                          <Input placeholder="12345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                              placeholder="********"
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
                    建立帳戶
                  </Button>
                </form>
              </Form>
              <div className="mt-4 text-center text-sm">
                已經有帳戶了嗎？{' '}
                <Link href="/login" className="underline">
                  登入
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
