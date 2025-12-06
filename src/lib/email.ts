
'use server';

import nodemailer from 'nodemailer';
import type { MailOptions, Attachment } from 'nodemailer/lib/mailer';
import type { Reservation } from '@/types';
import type { ContactInfo } from '@/app/admin/settings/actions';
import { getRoomSettings } from '@/app/admin/settings/actions';

type EmailOptions = {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
};

const isEmailConfigured = 
  process.env.EMAIL_SERVER_HOST &&
  process.env.EMAIL_SERVER_PORT &&
  process.env.EMAIL_SERVER_USER &&
  process.env.EMAIL_SERVER_PASSWORD &&
  process.env.EMAIL_FROM_NAME;

let transporter: nodemailer.Transporter | null = null;

if (isEmailConfigured) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT),
    secure: Number(process.env.EMAIL_SERVER_PORT) === 465,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });
} else {
    console.warn("⚠️ Email service is not configured. Emails will not be sent. Please check all EMAIL_... variables in your .env.local file.");
}

async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!transporter || !process.env.EMAIL_SERVER_USER || !process.env.EMAIL_FROM_NAME) {
    console.error("Cannot send email: Email service is not configured or sender user/name is missing.");
    return false;
  }
  
  const mailOptions: MailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_SERVER_USER}>`,
    to: options.to,
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${options.to}`);
    return true;
  } catch (error) {
    console.error(`Error sending email to ${options.to}:`, error);
    return false;
  }
}

function generateQrCodeEmailHtml(reservation: Reservation, contactInfo: ContactInfo): string {
  const whatsappNumber = contactInfo.whatsapp || '未提供';
  const address = contactInfo.address || '未提供';

  return `
    <!DOCTYPE html>
    <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>您的預訂確認及 QR Code</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f7; color: #333; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e2e2; border-radius: 8px; overflow: hidden; }
        .header { background-color: #ff6600; color: #ffffff; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { padding: 24px; }
        .qr-code-container { text-align: center; margin: 24px 0; }
        .qr-code-container img { max-width: 250px; width: 100%; border: 1px solid #ddd; padding: 5px; border-radius: 4px; }
        .details { border-top: 1px solid #eee; padding-top: 16px; }
        .details p { margin: 8px 0; font-size: 16px; }
        .details .label { color: #666; }
        .contact-info { margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 14px; color: #555; }
        .footer { background-color: #f8f8f8; padding: 16px; text-align: center; font-size: 12px; color: #888; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>預訂確認</h1>
        </div>
        <div class="content">
          <p>您好， ${reservation.userName}！</p>
          <p>感謝您的預訂。請在入場時於門口的掃描器出示以下 QR Code 以開啟門禁。</p>
          <div class="qr-code-container">
            <p class="label">專屬入場 QR Code</p>
            <img src="cid:qrcode@skbooking.com" alt="QR Code">
          </div>
          <div class="details">
            <p><span class="label">參考編號:</span> <strong>${reservation.id}</strong></p>
            <p><span class="label">枱號:</span> <strong>${reservation.roomName.replace('房間', '枱號')}</strong></p>
            <p><span class="label">日期:</span> <strong>${reservation.date}</strong></p>
            <p><span class="label">時段:</span> <strong>${reservation.startTime} - ${reservation.endTime}</strong></p>
          </div>
          <div class="contact-info">
            <p>如有任何問題，可 WhatsApp 諮詢：</p>
            <p><strong>${whatsappNumber}</strong></p>
            <p>地址：</p>
            <p><a style="color: #333; text-decoration: none;"><strong>${address}</strong></a></p>
          </div>
        </div>
        <div class="footer">
          <p>此為系統自動發送的郵件，請勿直接回覆。</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendQrCodeEmail(reservation: Reservation, qrCodeDataUrl: string, contactInfo: ContactInfo): Promise<boolean> {
    const htmlContent = generateQrCodeEmailHtml(reservation, contactInfo);
    const base64Data = qrCodeDataUrl.split(';base64,').pop();

    if (!base64Data) {
        console.error(`Failed to extract base64 data from QR Code Data URL for reservation ${reservation.id}`);
        return false;
    }

    return sendEmail({
        to: reservation.userEmail,
        subject: `您的預訂確認及入場 QR Code (Ref: ${reservation.id})`,
        html: htmlContent,
        attachments: [
        {
            filename: 'qrcode.png',
            content: base64Data,
            encoding: 'base64',
            cid: 'qrcode@skbooking.com'
        }
        ]
    });
}
