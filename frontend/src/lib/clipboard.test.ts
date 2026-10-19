import { describe, it, expect } from "vitest";
import { formatPhoneNumbers } from "./clipboard";

describe("formatPhoneNumbers (Item 11)", () => {
  const members = [
    { name: "Dawit Abebe", phoneNumber: "+251911223344" },
    { name: "Sara Tesfaye", phoneNumber: "0922334455" },
    { name: "No Phone Member", phoneNumber: "" },
    { name: "Null Phone Member", phoneNumber: null },
    { name: "Whitespace Phone", phoneNumber: "   " },
  ];

  it("formats as numbers only and reports skipped counts correctly", () => {
    const result = formatPhoneNumbers(members, "NUMBERS_ONLY");
    expect(result.copiedCount).toBe(2);
    expect(result.skippedCount).toBe(3);
    expect(result.text).toBe("+251911223344\n0922334455");
    expect(result.summaryMessage).toBe("Copied 2, 3 skipped (no phone)");
  });

  it("formats as Name - number", () => {
    const result = formatPhoneNumbers(members, "NAME_NUMBER");
    expect(result.copiedCount).toBe(2);
    expect(result.skippedCount).toBe(3);
    expect(result.text).toBe("Dawit Abebe - +251911223344\nSara Tesfaye - 0922334455");
  });

  it("handles zero valid phone numbers gracefully", () => {
    const result = formatPhoneNumbers([{ name: "Empty", phoneNumber: null }]);
    expect(result.copiedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.summaryMessage).toBe("No phone numbers available to copy.");
  });
});
