import React from "react";
import { Search, X } from "lucide-react";

export interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  rightActions?: React.ReactNode;
  className?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  children,
  rightActions,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        {/* Search Input */}
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Custom Filter Controls / Dropdowns */}
        {children}
      </div>

      {/* Right Side Actions / Sort Controls */}
      {rightActions && (
        <div className="flex items-center gap-2 flex-wrap self-end md:self-auto border-t md:border-t-0 pt-2 md:pt-0 border-slate-100">
          {rightActions}
        </div>
      )}
    </div>
  );
};

export default FilterBar;
