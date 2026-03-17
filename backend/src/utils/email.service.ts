import axios from "axios";

interface MemberData {
  name: string;
  uniqueId: string;
  phoneNumber?: string | null;
}

type InlineAttachment = {
  content: string;
  name: string;
};

/**
 * Core function to send emails via Brevo REST API using axios.
 *
 * @param to - Recipient email address
 * @param subject - Email subject
 * @param htmlContent - Email HTML body
 */
async function sendBrevoEmail(
  to: string,
  subject: string,
  htmlContent: string,
  attachment?: InlineAttachment,
) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error("Email configuration missing: BREVO_API_KEY not set.");
    return;
  }

  const emailFromEnv = process.env.EMAIL_FROM || "no-reply@example.com";
  let senderName = "Attendance System";
  let senderEmail = "no-reply@example.com";

  const match = emailFromEnv.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    senderName = match[1].trim() || senderName;
    senderEmail = match[2].trim();
  } else {
    senderEmail = emailFromEnv.trim();
  }

  const payload: any = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    htmlContent,
  };

  if (attachment) {
    payload.attachment = [
      {
        content: attachment.content,
        name: attachment.name,
      },
    ];
  }

  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      payload,
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    console.log(
      `Email sent successfully to ${to}. Message ID: ${response.data.messageId}`,
    );
  } catch (error: any) {
    console.error(
      `Failed to send email to ${to}:`,
      error.response?.data || error.message,
    );
  }
}

/**
 Sends a welcome email with the member's details and QR code 
 @param memberEmail - member's email address
 @param memberData - object containing name, uniqueId, and phoneNumber
 @param qrBase64 - base64 string of the qr code image
 */
export const sendMemberEmail = async (
  memberEmail: string,
  memberData: MemberData,
  qrBase64: string,
): Promise<void> => {
  const subject = "Your Hymn Attendance QR Code";
  const qrBase64Content = qrBase64.replace(
    /^data:image\/[a-zA-Z]+;base64,/,
    "",
  );

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <h2 style="color: #333; text-align: center;">Welcome to the Hymn Department</h2>
      <p>Dear <strong>${memberData.name}</strong>,</p>
      <p>Thank you for registering! Here are your membership details:</p>
      <ul style="list-style: none; padding: 0;">
        <li><strong>Unique ID:</strong> ${memberData.uniqueId}</li>
        <li><strong>Phone:</strong> ${memberData.phoneNumber || "N/A"}</li>
      </ul>
      <div style="text-align: center; margin: 20px 0;">
        <p><strong>Your Attendance QR Code:</strong></p>
        <img src="data:image/png;base64,${qrBase64Content}" alt="Your QR Code" width="200" height="200" style="display: block; margin: 0 auto; max-width: 200px; height: auto; border: 1px solid #ccc; padding: 10px;" />
      </div>
      <p style="font-size: 0.9em; color: #666; text-align: center;">Please keep this QR code safe. You will need it to mark your attendance.</p>
      <p style="font-size: 0.8em; color: #888; text-align: center; margin-top: 12px;">If the image above does not load, the QR code is also attached to this email as <strong>${memberData.uniqueId}-qr.png</strong>.</p>
    </div>
  `;

  // Call the core Brevo REST function
  await sendBrevoEmail(memberEmail, subject, htmlContent, {
    content: qrBase64Content,
    name: `${memberData.uniqueId}-qr.png`,
  });
};
