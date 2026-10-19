import React from "react";

export type ChipVariant =
  | "ACTIVE"
  | "UPCOMING"
  | "PAST"
  | "CANCELLED"
  | "DEACTIVATED"
  | "PRESENT"
  | "LATE"
  | "EXCUSED"
  | "ABSENT"
  | "DEFAULT";

export interface StatusChipProps {
  status: string;
  variant?: ChipVariant;
  label?: string;
  size?: "sm" | "md";
}

const VARIANT_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  UPCOMING: "bg-blue-50 text-blue-700 border-blue-200/80",
  PAST: "bg-slate-100 text-slate-700 border-slate-200",
  CANCELLED: "bg-rose-50 text-rose-700 border-rose-200/80",
  DEACTIVATED: "bg-amber-50 text-amber-800 border-amber-200",
  PRESENT: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  LATE: "bg-amber-50 text-amber-800 border-amber-200",
  EXCUSED: "bg-indigo-50 text-indigo-700 border-indigo-200/80",
  ABSENT: "bg-rose-50 text-rose-700 border-rose-200/80",
  DEFAULT: "bg-slate-100 text-slate-700 border-slate-200",
};

export const StatusChip: React.FC<StatusChipProps> = ({
  status,
  variant,
  label,
  size = "md",
}) => {
  const effectiveVariant = variant || (VARIANT_STYLES[status] ? status : "DEFAULT");
  const style = VARIANT_STYLES[effectiveVariant] || VARIANT_STYLES.DEFAULT;
  const displayLabel = label || status.replace("_", " ");

  const sizeClass =
    size === "sm"
      ? "px-2 py-0.5 text-[11px] font-semibold"
      : "px-2.5 py-1 text-xs font-bold";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border shadow-sm ${sizeClass} ${style} whitespace-nowrap`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      <span>{displayLabel}</span>
    </span>
  );
};

export default StatusChip;
