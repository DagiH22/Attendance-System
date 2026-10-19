/**
 * Robust clipboard utility with navigator.clipboard and fallback for non-secure contexts.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("navigator.clipboard failed, attempting fallback:", e);
    }
  }

  // Fallback for non-secure contexts / legacy browsers
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("Clipboard copy failed completely:", err);
    return false;
  }
}

export interface MemberPhoneEntry {
  name: string;
  phoneNumber?: string | null;
}

export type PhoneCopyFormat = "NUMBERS_ONLY" | "NAME_NUMBER";

export interface PhoneFormatResult {
  text: string;
  copiedCount: number;
  skippedCount: number;
  summaryMessage: string;
}

/**
 * Formats a list of members' phone numbers:
 * - Skips members without a phone number.
 * - Formats as either numbers only (one per line) or "Name - number".
 * - Returns copy text, counts, and friendly toast message.
 */
export function formatPhoneNumbers(
  entries: MemberPhoneEntry[],
  format: PhoneCopyFormat = "NUMBERS_ONLY",
): PhoneFormatResult {
  const valid: { name: string; phone: string }[] = [];
  let skippedCount = 0;

  for (const entry of entries) {
    const trimmedPhone = (entry.phoneNumber || "").trim();
    if (trimmedPhone) {
      valid.push({ name: (entry.name || "").trim(), phone: trimmedPhone });
    } else {
      skippedCount++;
    }
  }

  let text = "";
  if (format === "NAME_NUMBER") {
    text = valid.map((v) => `${v.name} - ${v.phone}`).join("\n");
  } else {
    text = valid.map((v) => v.phone).join("\n");
  }

  const copiedCount = valid.length;
  let summaryMessage = "";

  if (copiedCount === 0) {
    summaryMessage = "No phone numbers available to copy.";
  } else if (skippedCount > 0) {
    summaryMessage = `Copied ${copiedCount}, ${skippedCount} skipped (no phone)`;
  } else {
    summaryMessage = `Copied ${copiedCount} phone number${copiedCount === 1 ? "" : "s"}`;
  }

  return { text, copiedCount, skippedCount, summaryMessage };
}
