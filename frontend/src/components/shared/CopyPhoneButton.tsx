import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard } from "../../lib/clipboard";

export interface CopyPhoneButtonProps {
  phoneNumber?: string | null;
  className?: string;
  onCopied?: () => void;
}

export const CopyPhoneButton: React.FC<CopyPhoneButtonProps> = ({
  phoneNumber,
  className = "",
  onCopied,
}) => {
  const [copied, setCopied] = useState(false);

  if (!phoneNumber) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await copyToClipboard(phoneNumber.trim());
    if (success) {
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : `Copy phone (${phoneNumber})`}
      className={`inline-flex items-center justify-center p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition active:scale-95 ${className}`}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-600 animate-in zoom-in-75 duration-100" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
};

export default CopyPhoneButton;
