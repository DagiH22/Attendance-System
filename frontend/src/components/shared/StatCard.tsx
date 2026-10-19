import React from "react";
import type { LucideIcon } from "lucide-react";

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  iconBgColor?: string;
  iconColor?: string;
  onClick?: () => void;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  icon: Icon,
  iconBgColor = "bg-blue-50",
  iconColor = "text-blue-600",
  onClick,
  className = "",
}) => {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md ${
        onClick ? "cursor-pointer" : ""
      } ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${iconBgColor} ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          {value}
        </span>
        {subtext && (
          <span className="text-xs font-medium text-slate-500">{subtext}</span>
        )}
      </div>
    </div>
  );
};

export default StatCard;
