
'use server'

import nodemailer from 'nodemailer';
import type { Reservation } from '@/types';
import type { ContactInfo } from '@/app/admin/settings/actions';
import type { User as AppUser } from '@/app/admin/users/actions';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { createHmac } from 'crypto';


const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER;
const EMAIL_SERVER_PASSWORD = process.env.EMAIL_SERVER_PASSWORD;
const EMAIL_SERVER_HOST = process.env.EMAIL_SERVER_HOST;
const EMAIL_SERVER_PORT = process.env.EMAIL_SERVER_PORT;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME;
const EMAIL_VERIFICATION_SECRET = process.env.EMAIL_VERIFICATION_SECRET;
const APP_BASE_URL =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000';
const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const hasEmailConfig = EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD && EMAIL_SERVER_HOST && EMAIL_SERVER_PORT && EMAIL_FROM_NAME;

if (!hasEmailConfig) {
    console.warn("⚠️ Email service is not fully configured. One or more Nodemailer environment variables are missing.");
}

const transporter = hasEmailConfig ? nodemailer.createTransport({
    host: EMAIL_SERVER_HOST,
    port: Number(EMAIL_SERVER_PORT),
    secure: Number(EMAIL_SERVER_PORT) === 465, // true for 465, false for other ports
    auth: {
        user: EMAIL_SERVER_USER,
        pass: EMAIL_SERVER_PASSWORD,
    },
}) : null;

type EmailVerificationPayload = {
    uid: string;
    email: string;
    exp: number;
};

function toBase64Url(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function signVerificationPayload(payload: EmailVerificationPayload): string {
    if (!EMAIL_VERIFICATION_SECRET) {
        throw new Error('EMAIL_VERIFICATION_SECRET is not configured.');
    }
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = createHmac('sha256', EMAIL_VERIFICATION_SECRET).update(encodedPayload).digest('base64url');
    return `${encodedPayload}.${signature}`;
}

export function verifyEmailVerificationToken(token: string): { uid: string; email: string } {
    if (!EMAIL_VERIFICATION_SECRET) {
        throw new Error('EMAIL_VERIFICATION_SECRET is not configured.');
    }
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        throw new Error('Invalid token format.');
    }
    const expectedSignature = createHmac('sha256', EMAIL_VERIFICATION_SECRET).update(encodedPayload).digest('base64url');
    if (expectedSignature !== signature) {
        throw new Error('Invalid token signature.');
    }

    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as EmailVerificationPayload;
    if (!parsed.uid || !parsed.email || !parsed.exp) {
        throw new Error('Invalid token payload.');
    }
    if (Date.now() > parsed.exp) {
        throw new Error('Token has expired.');
    }
    return { uid: parsed.uid, email: parsed.email };
}

export async function sendCustomVerificationEmail(params: {
    uid: string;
    email: string;
    userName?: string;
}): Promise<boolean> {
    if (!transporter || !EMAIL_SERVER_USER || !EMAIL_FROM_NAME) {
        console.error('Cannot send verification email: Email service is not configured.');
        return false;
    }

    try {
        const token = signVerificationPayload({
            uid: params.uid,
            email: params.email,
            exp: Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000,
        });
        const verifyUrl = new URL('/verify-email', APP_BASE_URL);
        verifyUrl.searchParams.set('token', token);

        const mailOptions = {
            from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
            to: params.email,
            subject: '歡迎加入 Snooker Kingdom！請確認您的電子郵件',
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #1f2937; max-width: 640px; margin: 0 auto;">
                    <div style="padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
                        <h2 style="margin: 0 0 16px; color: #111827;">歡迎加入 Snooker Kingdom！</h2>
                        <p style="margin: 0 0 12px;">您好${params.userName ? ` ${params.userName}` : ''}，</p>
                        <p style="margin: 0 0 18px;">
                            感謝你註冊 Snooker Kingdom。請點擊下方按鈕完成電子郵件驗證，啟用你的帳戶。
                        </p>
                        <div style="margin: 24px 0; text-align: center;">
                            <a href="${verifyUrl.toString()}"
                               style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 22px; border-radius: 8px; font-weight: 600;">
                                立即驗證電子郵件
                            </a>
                        </div>
                        <p style="margin: 0 0 8px; font-size: 14px; color: #4b5563;">如果按鈕無法點擊，請複製以下連結到瀏覽器開啟：</p>
                        <p style="margin: 0; word-break: break-all; font-size: 14px; color: #2563eb;">${verifyUrl.toString()}</p>
                        <hr style="margin: 24px 0; border: 0; border-top: 1px solid #e5e7eb;" />
                        <p style="margin: 0; font-size: 13px; color: #6b7280;">
                            此驗證連結將於 24 小時後失效。若非你本人操作，請忽略此郵件。
                        </p>
                    </div>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send verification email to ${params.email}:`, error);
        return false;
    }
}


export async function sendQrCodeEmail(
    reservation: Reservation,
    qrCodeDataUrl: string,
    contactInfo: ContactInfo
): Promise<boolean> {
    if (!transporter) {
        console.error("Cannot send email: Email service is not configured or failed to initialize.");
        return false;
    }

    // --- FIX: Use CID inline attachments for the QR code ---
    const qrCodeCid = `qrcode_${reservation.id}@sk-booking.com`;
    // Extract the Base64 part of the data URL
    const base64Data = qrCodeDataUrl.split(';base64,').pop();

    if (!base64Data) {
        console.error(`❌ Failed to extract Base64 data from QR code Data URL for reservation ${reservation.id}`);
        return false;
    }

    const mailOptions = {
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
        to: reservation.userEmail,
        subject: `您在 ${EMAIL_FROM_NAME} 的預訂確認 (QR Code)`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>感謝您的預訂！</h2>
                <p>您好 ${reservation.userName}，</p>
                <p>您的預訂已成功確認。請在預約時間到達時，使用以下 QR Code 掃描門口的裝置以進入。</p>
                <p>如相關 QR code 沒接收/開啟有問題，您亦可在我們的預訂網站"我的預訂"中，按顯示入場二維碼找到相關 QR Code 掃描門口的裝置以進入。</p>
                <hr>
                <h3>預訂詳情：</h3>
                <ul>
                    <li><strong>參考編號:</strong> ${reservation.id}</li>
                    <li><strong>房間:</strong> ${reservation.roomName.replace('房間', '枱號')}</li>
                    <li><strong>日期:</strong> ${reservation.date}</li>
                    <li><strong>時間:</strong> ${reservation.startTime} - ${reservation.endTime}</li>
                </ul>
                <p>這是您的專屬入場 QR Code，請勿分享給他人：</p>
                <div style="text-align: center; margin: 20px 0;">
                    <img src="cid:${qrCodeCid}" alt="Reservation QR Code" style="width: 250px; height: 250px;" />
                </div>
                <hr>
                <p>如有任何問題，歡迎隨時與我們聯絡。</p>
                <p>
                    <strong>${EMAIL_FROM_NAME}</strong><br>
                    電話: ${contactInfo.whatsapp}<br>
                    電郵: ${contactInfo.email}<br>
                    地址: ${contactInfo.address}
                </p>
            </div>
        `,
        attachments: [
            {
                filename: 'qrcode.png',
                content: base64Data,
                encoding: 'base64',
                cid: qrCodeCid, // Set the Content-ID
            },
        ],
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Confirmation email sent to ${reservation.userEmail} for reservation ${reservation.id}`);
        return true;
    } catch (error) {
        // Log the full error for better debugging
        console.error(`❌ Failed to send email for reservation ${reservation.id}:`, error);
        return false;
    }
}

// New function to send top-up confirmation email
const TOP_UP_AMOUNT_DISCREPANCY_NOTICE =
    '請注意：此記錄與要求金額有出入，我們以最後收到轉帳之金額作最後的充值額。';

export async function sendTopUpConfirmationEmail(
    user: AppUser,
    topUpAmount: number,
    newBalance: number,
    contactInfo: ContactInfo,
    options?: { hasDiscrepancy?: boolean },
): Promise<boolean> {
    
    if (!transporter) {
        console.error("Cannot send email: Email service is not configured or failed to initialize.");
        return false;
    }

    const discrepancyBlock =
        options?.hasDiscrepancy === true
            ? `<p style="margin:16px 0;padding:12px 14px;background:#ffedd5;border-left:4px solid #ea580c;color:#9a3412;border-radius:4px;"><strong>${TOP_UP_AMOUNT_DISCREPANCY_NOTICE}</strong></p>`
            : '';

    const mailOptions = {
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
        to: user.email,
        subject: `您在 ${EMAIL_FROM_NAME} 的帳戶增值成功`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>帳戶增值成功！</h2>
                <p>致 ${user.name}，</p>
                <p>您的帳戶已成功增值。</p>
                ${discrepancyBlock}
                <hr>
                <h3>增值詳情：</h3>
                <ul>
                    <li><strong>增值時間:</strong> ${new Date().toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong', hour12: false }).replace(/,/, '')}</li>
                    <li><strong>增值金額:</strong> HKD ${topUpAmount.toFixed(2)}</li>
                    <li><strong>最新餘額:</strong> <strong>HKD ${newBalance.toFixed(2)}</strong></li>
                </ul>
                <hr>
                <p>感謝您的支持！</p>
                <p>
                    <strong>${EMAIL_FROM_NAME}</strong><br>
                    電話: ${contactInfo.whatsapp}<br>
                    電郵: ${contactInfo.email}<br>
                    地址: ${contactInfo.address}
                </p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Top-up confirmation email sent to ${user.email}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send top-up email to ${user.email}:`, error);
        return false;
    }
}

export async function sendTemporaryAccessQrEmail(params: {
    recipientEmail: string;
    qrSecret: string;
    qrCodeDataUrl: string;
    /** 使用者按下申請的瞬間（ISO） */
    requestedAtIso: string;
    /** 不向收件人展示內部 A/B 段；依角色套用說明 */
    audience: 'vvip' | 'admin' | 'other';
    contactInfo: ContactInfo;
}): Promise<boolean> {
    if (!transporter) {
        console.error('Cannot send email: Email service is not configured or failed to initialize.');
        return false;
    }

    const { recipientEmail, qrSecret, qrCodeDataUrl, requestedAtIso, audience, contactInfo } = params;

    const qrCodeCid = `tempaccess_${qrSecret.slice(0, 16)}@sk-booking.com`;
    const base64Data = qrCodeDataUrl.split(';base64,').pop();
    if (!base64Data) {
        console.error('Failed to extract Base64 data from temporary access QR Data URL');
        return false;
    }

    const requestedLabel = formatInTimeZone(new Date(requestedAtIso), 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm');

    const validityHtml =
        audience === 'admin'
            ? `<p>您於香港時間 <strong>${requestedLabel}</strong> 建立此臨時進出碼。請轉發附件 QR Code 予訪客使用；無須向訪客說明內部時段劃分。</p>`
            : audience === 'vvip'
              ? `<p>您於香港時間 <strong>${requestedLabel}</strong> 按下申請。此臨時進出碼於接下來 <strong>30 分鐘</strong>內有效，請於時限內使用附件 QR Code。</p>`
              : `<p>您於香港時間 <strong>${requestedLabel}</strong> 按下申請。此臨時進出碼於接下來 <strong>30 分鐘</strong>內有效，請於時限內使用附件 QR Code。</p>`;
    const mailOptions = {
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
        to: recipientEmail,
        subject: `您在 ${EMAIL_FROM_NAME} 的臨時進出 QR Code`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>臨時進出碼</h2>
                <p>您好，</p>
                ${validityHtml}
                <div style="text-align: center; margin: 20px 0;">
                    <img src="cid:${qrCodeCid}" alt="Temporary access QR Code" style="width: 250px; height: 250px;" />
                </div>
                <p>如有任何問題，歡迎隨時與我們聯絡。</p>
                <p>
                    <strong>${EMAIL_FROM_NAME}</strong><br>
                    電話: ${contactInfo.whatsapp}<br>
                    電郵: ${contactInfo.email}<br>
                    地址: ${contactInfo.address}
                </p>
            </div>
        `,
        attachments: [
            {
                filename: 'temporary-access-qrcode.png',
                content: base64Data,
                encoding: 'base64',
                cid: qrCodeCid,
            },
        ],
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Temporary access email sent to ${recipientEmail}`);
        return true;
    } catch (error) {
        console.error(`Failed to send temporary access email to ${recipientEmail}:`, error);
        return false;
    }
}

export async function sendProblemTransactionAlertEmails(
  recipients: string[],
  payerName: string,
  htmlBody: string,
): Promise<void> {
  if (!recipients.length) {
    console.warn('[Email] 問題交易警報：未設定任何 alertEmails，略過發送。');
    return;
  }
  if (!transporter || !EMAIL_SERVER_USER || !EMAIL_FROM_NAME) {
    console.error('[Email] 問題交易警報：郵件服務未設定，無法發送。');
    return;
  }

  const subject = `[問題交易] - ${payerName}`;

  for (const to of recipients) {
    try {
      await transporter.sendMail({
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
        to,
        subject,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>問題交易通知</h2>
                <p>付款人（銀行顯示名稱）: <strong>${payerName}</strong></p>
                ${htmlBody}
                <hr>
                <p style="font-size:12px;color:#666;">此郵件由系統自動發出。</p>
            </div>
        `,
      });
      console.log(`✅ 問題交易警報已發送至 ${to}`);
    } catch (error) {
      console.error(`❌ 問題交易警報發送至 ${to} 失敗:`, error);
    }
  }
}
