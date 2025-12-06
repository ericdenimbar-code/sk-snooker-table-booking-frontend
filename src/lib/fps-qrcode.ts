
'use server';

/**
 * Calculates CRC-16/CCITT-FALSE.
 * This is crucial for ensuring the QR code is valid according to HKMA standards.
 * @param data The payload string.
 * @returns The 4-character hexadecimal CRC checksum.
 */
function crc16(data: string): string {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}


/**
 * Generates an HKMA-compliant FPS QR Code payload string.
 * This string is then encoded into the QR code image.
 * @param fpsId The merchant's FPS identifier (phone number, email, or FPS ID).
 * @param amount The transaction amount.
 * @param transactionId A reference ID for the transaction (e.g., bill number).
 * @returns The fully-formed payload string.
 */
function getFpsPayload(fpsId: string, amount: number, transactionId: string): string {
    // Helper to create a Tag-Length-Value (TLV) string
    const createTlv = (tag: string, value: string): string => {
        // Use Buffer.byteLength for accurate length calculation, especially for non-ASCII chars
        const length = Buffer.byteLength(value).toString().padStart(2, '0');
        return `${tag}${length}${value}`;
    };

    // --- Field Assembly following HKMA Standard ---

    // Tag 00: Payload Format Indicator (Value: "01")
    const f00 = createTlv('00', '01');

    // Tag 01: Point-of-Initiation Method. "11" for dynamic QR (amount is present).
    const f01 = createTlv('01', '11');

    // Tag 26: Merchant Account Information (This is a template containing other nested TLVs)
    // Create the *value* of Tag 26 first.
    const f26_00_gui = createTlv('00', 'hk.com.hkicl'); // HKICL GUI
    const f26_02_merchantId = createTlv('02', fpsId);   // The actual FPS number/email
    const f26_value = `${f26_00_gui}${f26_02_merchantId}`;
    // Now, create the final Tag 26 TLV with the combined value.
    const f26 = createTlv('26', f26_value);

    // Tag 53: Transaction Currency (Value: "344" for HKD)
    const f53 = createTlv('53', '344');

    // Tag 54: Transaction Amount
    const amountStr = amount.toFixed(2);
    const f54 = createTlv('54', amountStr);
    
    // Tag 58: Country Code (Value: "HK")
    const f58 = createTlv('58', 'HK');

    // Tag 62: Additional Data Field (Template for reference ID)
    // Use Tag 01 (Bill Number) for the best compatibility.
    const f62_01_billNumber = createTlv('01', transactionId); 
    const f62_value = f62_01_billNumber;
    const f62 = createTlv('62', f62_value);

    // Tag 63: CRC Checksum
    // The CRC is calculated on all preceding fields, plus "6304" itself.
    const payloadWithoutCrc = `${f00}${f01}${f26}${f53}${f54}${f58}${f62}6304`;
    const crc = crc16(payloadWithoutCrc);
    
    return `${payloadWithoutCrc}${crc}`;
}


export async function generateFpsQrCodeUrl(fpsId: string, amount: number, transactionId: string): Promise<string> {
    if (!fpsId || amount <= 0) {
        return '';
    }
    const payload = getFpsPayload(fpsId, amount, transactionId);
    // Use qrserver.com to generate the QR code image from the payload string.
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(payload)}`;
}
