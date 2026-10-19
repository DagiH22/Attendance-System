import React, { useState, useRef, useEffect } from "react";
import { Copy, ChevronDown, Phone } from "lucide-react";
import { copyToClipboard, formatPhoneNumbers, type MemberPhoneEntry, type PhoneCopyFormat } from "../../lib/clipboard";

export interface CopyAllPhonesDropdownProps {
  members: MemberPhoneEntry[];
  onToast?: (message: string, tone?: "success" | "error") => void;
  className?: string;
  label?: string;
}

export const CopyAllPhonesDropdown: React.FC<CopyAllPhonesDropdownProps> = ({
  members,
  onToast,
  className = "",
  label = "Copy phones",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopy = async (format: PhoneCopyFormat) => {
    setIsOpen(false);
    const { text, copiedCount, summaryMessage } = formatPhoneNumbers(members, format);

    if (copiedCount === 0) {
      onToast?.(summaryMessage, "error");
      return;
    }

    const ok = await copyToClipboard(text);
    if (ok) {
      onToast?.(summaryMessage, "success");
    } else {
      onToast?.("Failed to copy phone numbers to clipboard.", "error");
    }
  };

  return (
    <div className={`relative inline-flex ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition active:scale-[0.98]"
        title="Copy filtered phone numbers"
      >
        <Phone className="w-3.5 h-3.5 text-slate-500" />
        <span>{label}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl bg-white p-1.5 shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            onClick={() => handleCopy("NUMBERS_ONLY")}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            <span>Numbers only</span>
          </button>
          <button
            type="button"
            onClick={() => handleCopy("NAME_NUMBER")}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 transition mt-0.5"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            <span>Name - number</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default CopyAllPhonesDropdown;
