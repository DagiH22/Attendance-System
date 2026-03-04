import QRCode from "qrcode";
import { Jimp } from "jimp";
import path from "path";
import fs from "fs";

const LOGO_PATH = path.join(process.cwd(), "assets", "logo.png");
const LOGO_RATIO = 0.3; // Logo size relative to QR code size 

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
      scale: 8, // Reduced scale to prevent 'Array buffer allocation failed' memory issues
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

    // Safety check: resize logo to a maximum reasonable size to avoid massive memory spikes
    const logoSize = Math.floor(qrWidth * LOGO_RATIO);
    // Prefer integer sizes
    logo.resize({ w: logoSize, h: logoSize });

    // Ensure the logo is fully opaque (100%) before compositing
    try {
      // Jimp exposes `opacity` in some builds; guard access to avoid TS/runtime issues
      if (typeof (logo as any).opacity === "function") {
        (logo as any).opacity(1);
      } else if (typeof (logo as any).alpha === "function") {
        // fallback if available
        (logo as any).alpha(1);
      }
    } catch (e) {
      // non-fatal; we'll force opacity via composite options below
    }

    // Calculate position to center the logo
    const x = (qrWidth - logoSize) / 2;
    const y = (qrHeight - logoSize) / 2;

    // Composite the logo onto the QR code with full opacity
    // Provide opacitySource to ensure the logo is rendered at 100% opacity
    qrImage.composite(logo, x, y, { opacitySource: 1, opacityDest: 1 });

    // Return as base64 string
    const finalBuffer = await qrImage.getBuffer("image/png");
    return `data:image/png;base64,${finalBuffer.toString("base64")}`;
  } catch (error) {
    console.error("Error generating QR code with logo:", error);
    throw new Error("Failed to generate QR code");
  }
};
