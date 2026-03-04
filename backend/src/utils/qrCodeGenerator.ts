import QRCode from "qrcode";
import { Jimp } from "jimp";
import path from "path";
import fs from "fs";

const LOGO_PATH = path.join(process.cwd(), "assets", "logo.png");
const LOGO_RATIO = 0.2; // Logo size relative to QR code size (20%)

/**
 * Generates a QR code for a member with their unique ID and overlays a central logo.
 * @param uniqueId The member's unique ID string.
 * @returns A Promise resolving to a base64 string of the QR code image (data:image/png;base64,...).
 */
export const generateQrWithLogo = async (uniqueId: string): Promise<string> => {
  try {
    // Generate QR Code as a Buffer
    const qrBuffer = await QRCode.toBuffer(uniqueId, {
      errorCorrectionLevel: "H", // High error correction to allow logo
      margin: 2,
      scale: 10, // Higher scale for better quality
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    // Load QR Code image into Jimp
    const qrImage = await Jimp.read(qrBuffer);
    const qrWidth = qrImage.width;
    const qrHeight = qrImage.height;

    // Check if logo exists, otherwise return plain QR
    if (!fs.existsSync(LOGO_PATH)) {
      console.warn(
        `Logo not found at ${LOGO_PATH}, generating QR without logo.`,
      );
      const buffer = await qrImage.getBuffer("image/png");
      return `data:image/png;base64,${buffer.toString("base64")}`;
    }

    const logo = await Jimp.read(LOGO_PATH);
    const logoSize = qrWidth * LOGO_RATIO;
    logo.resize({ w: logoSize, h: logoSize });

    // Calculate position to center the logo
    const x = (qrWidth - logoSize) / 2;
    const y = (qrHeight - logoSize) / 2;

    // Composite the logo onto the QR code
    qrImage.composite(logo, x, y);

    // Return as base64 string
    const finalBuffer = await qrImage.getBuffer("image/png");
    return `data:image/png;base64,${finalBuffer.toString("base64")}`;
  } catch (error) {
    console.error("Error generating QR code with logo:", error);
    throw new Error("Failed to generate QR code");
  }
};
