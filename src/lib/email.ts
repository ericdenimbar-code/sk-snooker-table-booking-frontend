'use server'

import nodemailer from 'nodemailer';
import type { Reservation } from '@/types';
import type { ContactInfo } from '@/app/admin/settings/actions';


const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER;
const EMAIL_SERVER_PASSWORD = process.env.EMAIL_SERVER_PASSWORD;
const EMAIL_SERVER_HOST = process.env.EMAIL_SERVER_HOST;
const EMAIL_SERVER_PORT = process.env.EMAIL_SERVER_PORT;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME;

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
                <p>親愛的 ${reservation.userName}，</p>
                <p>您的預訂已成功確認。請在預約時間到達時，使用以下 QR Code 掃描門口的裝置以進入。</p>
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
