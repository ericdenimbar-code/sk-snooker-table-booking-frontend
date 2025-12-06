'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Loader2, MailCheck, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/lib/firebase';
import { sendPasswordResetEmail } from 'firebase/auth';

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: '無效的電子郵件地址。' }),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setIsLoading(true);
    
    try {
      await sendPasswordResetEmail(auth, values.email);
      setIsSubmitted(true);
    } catch (error: any) {
      // We don't want to reveal if an email exists or not for security reasons.
      // So, we show a generic success message even if the email is not found.
      // However, we can handle other specific errors if needed.
      if (error.code === 'auth/user-not-found') {
        setIsSubmitted(true); // Treat as success to prevent user enumeration
      } else {
        toast({
          variant: 'destructive',
          title: '請求失敗',
          description: '重設密碼時發生未知錯誤，請稍後再試。',
        });
      }
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
          <CardTitle>忘記密碼</CardTitle>
          <CardDescription>
            {isSubmitted 
              ? "請求已送出" 
              : "請輸入您的電子郵件地址，我們會傳送重設密碼的指示給您。"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSubmitted ? (
            <div className="text-center space-y-4">
              <MailCheck className="h-16 w-16 text-green-500 mx-auto" />
              <p className="text-muted-foreground">
                如果此電子郵件地址存在於我們的系統中，您將很快會收到一封包含重設密碼指示的郵件。
              </p>
              <Button asChild className="w-full">
                <Link href="/login">返回登入</Link>
              </Button>
            </div>
          ) : (
            <>
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
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    傳送重設郵件
                  </Button>
                </form>
              </Form>
              <div className="mt-4 text-center text-sm">
                <Link href="/login" className="underline">
                  返回登入
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
