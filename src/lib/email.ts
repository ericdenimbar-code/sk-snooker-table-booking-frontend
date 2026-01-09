
'use server'

import nodemailer from 'nodemailer';
import type { Reservation } from '@/types';
import type { ContactInfo } from '@/app/admin/settings/actions';
import type { User as AppUser } from '@/app/admin/users/actions';
import { format } from 'date-fns';

function getTransporter() {
    const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER;
    const EMAIL_SERVER_PASSWORD = process.env.EMAIL_SERVER_PASSWORD;
    const EMAIL_SERVER_HOST = process.env.EMAIL_SERVER_HOST;
    const EMAIL_SERVER_PORT = process.env.EMAIL_SERVER_PORT;

    const hasEmailConfig = EMAIL_SERVER_USER && EMAIL_SERVER_PASSWORD && EMAIL_SERVER_HOST && EMAIL_SERVER_PORT;

    if (!hasEmailConfig) {
        console.error("❌ Cannot create email transporter: Email service is not fully configured.");
        return null;
    }

    return nodemailer.createTransport({
        host: EMAIL_SERVER_HOST,
        port: Number(EMAIL_SERVER_PORT),
        secure: Number(EMAIL_SERVER_PORT) === 465, // true for 465, false for other ports
        auth: {
            user: EMAIL_SERVER_USER,
            pass: EMAIL_SERVER_PASSWORD,
        },
    });
}

// This function sends a confirmation email with a QR code for a reservation.
export async function sendQrCodeEmail(
    reservation: Reservation,
    qrCodeDataUrl: string,
    contactInfo: ContactInfo
): Promise<boolean> {
    
    const transporter = getTransporter();
    const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Snooker Kingdom Booking';
    const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER;

    if (!transporter || !EMAIL_SERVER_USER) return false;

    // Use CID (Content-ID) for inline attachments to improve email client compatibility.
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
export async function sendTopUpConfirmationEmail(
    user: AppUser,
    topUpAmount: number,
    newBalance: number,
    contactInfo: ContactInfo
): Promise<boolean> {
    
    const transporter = getTransporter();
    const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Snooker Kingdom Booking';
    const EMAIL_SERVER_USER = process.env.EMAIL_SERVER_USER;
    
    if (!transporter || !EMAIL_SERVER_USER) return false;

    const mailOptions = {
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_SERVER_USER}>`,
        to: user.email,
        subject: `您在 ${EMAIL_FROM_NAME} 的帳戶增值成功`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2>帳戶增值成功！</h2>
                <p>親愛的 ${user.name}，</p>
                <p>您的帳戶已成功增值。</p>
                <hr>
                <h3>增值詳情：</h3>
                <ul>
                    <li><strong>增值時間:</strong> ${format(new Date(), 'yyyy-MM-dd HH:mm:ss')}</li>
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

    