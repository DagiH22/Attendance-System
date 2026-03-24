import axios from "axios";

interface MemberData {
  name: string;
  uniqueId: string;
  email?: string | null;
  gender?: string | null;
  phoneNumber?: string | null;
  department?: string | null;
  batch?: string | null;
  campus?: string | null;
}

type InlineAttachment = {
  content: string;
  name: string;
};

type InlineImage = InlineAttachment & { contentId?: string };

// --- Formatting helpers for display only in emails ---
const capitalize = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const formatEnum = (value: string): string => {
  // Normalizes values like "COMPUTER SCIENCE" or "COMPUTER_SCIENCE" -> "Computer Science"
  if (!value) return "";
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => capitalize(w))
    .join(" ");
};

const formatBatch = (value: string): string => {
  if (!value) return "";
  switch (value) {
    case "FRESHMAN":
      return "Freshman";
    case "POST_GRADUATE":
      return "Post Graduate";
    default:
      // YEAR_2 -> Year 2
      if (value.startsWith("YEAR_")) {
        const num = value.split("_")[1];
        return `Year ${num}`;
      }
      return formatEnum(value);
  }
};

const formatCampus = (value: string): string => {
  if (!value) return "";
  switch (value) {
    case "FOUR_KILO":
      return "4 Kilo";
    case "FIVE_KILO":
      return "5 Kilo";
    case "SIX_KILO":
      return "6 Kilo";
    case "ART":
      return "Art";
    default:
      return formatEnum(value);
  }
};

const formatGender = (value: string): string => {
  if (!value) return "";
  switch (value) {
    case "MALE":
      return "Male";
    case "FEMALE":
      return "Female";
    default:
      return capitalize(value);
  }
};

const formatDepartment = (value: string): string => {
  if (!value) return "";
  const v = value.trim().toUpperCase();
  switch (v) {
    case "BIO":
    case "BIOLOGY":
      return "Biology";
    case "CHEM":
    case "CHEMISTRY":
      return "Chemistry";
    case "CS":
      return "Computer Science";
    case "IS":
      return "Information Systems";
    case "GEO":
      return "Geology";
    case "STAT":
      return "Statistics";
    case "MATH":
      return "Mathematics";
    case "PHY":
      return "Physics";
    case "FRESHMAN":
      return "Freshman";
    default:
      return formatEnum(value);
  }
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
  inlineImage?: InlineImage,
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

  if (inlineImage) {
    // Brevo expects inlineImage array with content, name and contentId
    payload.inlineImage = [
      {
        content: inlineImage.content,
        name: inlineImage.name,
        contentId: inlineImage.contentId ?? "qr_code",
      },
    ];
  }

  try {
    const response = await axios.post<{ messageId?: string }>(
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
      `Email sent successfully to ${to}. Message ID: ${response.data?.messageId ?? "(unknown)"}`,
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
  const subject = "እንኳን ወደ መዝሙር ክፍል በደህና መጡ";
  const qrDataUri = qrBase64.startsWith("data:image")
    ? qrBase64
    : `data:image/png;base64,${qrBase64}`;
  const qrBase64Content = qrDataUri.replace(
    /^data:image\/[a-zA-Z]+;base64,/,
    "",
  );

  const emailValue = memberData.email || memberEmail || "-";
  const nameValue = memberData.name || "-";
  const genderValue = memberData.gender
    ? formatGender(String(memberData.gender))
    : "-";
  const phoneValue = memberData.phoneNumber || "-";
  const departmentValue = memberData.department
    ? formatDepartment(String(memberData.department))
    : "-";
  const batchValue = memberData.batch
    ? formatBatch(String(memberData.batch))
    : "-";
  const campusValue = memberData.campus
    ? formatCampus(String(memberData.campus))
    : "-";
  const uniqueIdValue = memberData.uniqueId || "-";

  const htmlContent = `
    <div style="font-family: Arial, Helvetica, sans-serif; background: #ffffff; color: #333333; max-width: 640px; margin: 0 auto; border: 1px solid #cdcc80; border-radius: 14px; overflow: hidden;">
      <div style="background: #03291f; color: #ffffff; padding: 20px 24px; text-align: center;">
        <h2 style="margin: 0; font-size: 22px; line-height: 1.4;">እንኳን ወደ መዝሙር ክፍል በደህና መጡ</h2>
      </div>

      <div style="padding: 24px;">
        <p style="margin: 0 0 12px 0; font-size: 16px; line-height: 1.8;">ሰላም <strong style="color: #03291f;">${nameValue}</strong> 👋</p>

        <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.9; color: #333333;">
          እንኳን ወደ መዝሙር ክፍል በደህና መጡ!<br />
        </p>

        <div style="background: #f9f9f2; border: 1px solid #cdcc80; border-radius: 10px; padding: 14px 16px; margin: 16px 0;">
          <h3 style="margin: 0 0 10px 0; color: #03291f; font-size: 16px;">📌 የተመዘገቡት መረጃዎች</h3>
          <ul style="list-style: none; margin: 0; padding: 0; line-height: 1.9; font-size: 14px; color: #333333;">
            <li><strong>ስም:</strong> ${nameValue}</li>
            <li><strong>ኢሜይል:</strong> ${emailValue}</li>
            <li><strong>ጾታ :</strong> ${genderValue}</li>
            <li><strong>ስልክ:</strong> ${phoneValue}</li>
            <li><strong>ዲፓርትመንት:</strong> ${departmentValue}</li>
            <li><strong>ባች:</strong> ${batchValue}</li>
            <li><strong>ካምፓስ:</strong> ${campusValue}</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 20px 0 10px 0; padding: 16px; border: 1px solid #939139; border-radius: 12px; background: #ffffff;">
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #03291f;"><strong>🆔 የእርስዎ መለያ (QR Code ID): ${uniqueIdValue}</strong></p>
          <img src="cid:qr_code" alt="QR Code" width="220" height="220" style="display: block; margin: 0 auto; max-width: 220px; width: 100%; height: auto; border: 6px solid #cdcc80; border-radius: 10px; background: #ffffff; padding: 10px;" />
        </div>

        <p style="margin: 12px 0 0 0; font-size: 12px; line-height: 1.7; text-align: center; color: #333333;">
          ከላይ ያለው ምስል ካልታየ የQR ኮዱ እንደ
          <strong>${uniqueIdValue}-qr.png</strong> በኢሜይሉ ላይ ተያይዞ ተልኳል።
        </p>

        <p style="margin: 18px 0 0 0; font-size: 14px; line-height: 1.9; color: #03291f; border-top: 1px dashed #cdcc80; padding-top: 14px;">
          "እግዚአብሔርን አመስግኑ፥ መዝሙር መልካም ነውና። ለአምላካችን ምስጋና ያማረ ነው"- መዝሙር 147:1
        </p>
      </div>

      <div style="background: #03291f; color: #cdcc80; text-align: center; padding: 10px 16px; font-size: 12px;">
        መዝሙር ክፍል • Attendance System
      </div>
    </div>
  `;

  // Call the core Brevo REST function with both inline image (CID) and attachment
  const attachment = {
    content: qrBase64Content,
    name: `${uniqueIdValue}-qr.png`,
  };
  const inlineImage = {
    content: qrBase64Content,
    name: `${uniqueIdValue}-qr.png`,
    contentId: "qr_code",
  };

  // Call Brevo with attachment and inlineImage so clients like Gmail can display the image inline via CID,
  // and other clients can download the attached file.
  await sendBrevoEmail(
    memberEmail,
    subject,
    htmlContent,
    attachment,
    inlineImage,
  );
};
