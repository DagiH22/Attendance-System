import React, { useState } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";

export interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
  rightActions?: React.ReactNode;
  className?: string;
  activeFilterCount?: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
  children,
  rightActions,
  className = "",
  activeFilterCount = 0,
}) => {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

  const hasControls = Boolean(children || rightActions);

  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4 shadow-sm ${className}`}
    >
      {/* Search Input Row with Mobile Filter Button */}
      <div className="flex items-center gap-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-9 py-2.5 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Mobile Filter Button */}
        {hasControls && (
          <button
            type="button"
            onClick={() => setIsMobileSheetOpen(true)}
            className="md:hidden min-h-[44px] px-3.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-slate-100 transition active:scale-[0.98]"
            aria-label="Open filters"
          >
            <SlidersHorizontal className="w-4 h-4 text-slate-600" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-black text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        )}

        {/* Desktop Custom Filter Controls */}
        <div className="hidden md:flex flex-1 flex-wrap items-center gap-2.5">
          {children}
        </div>

        {/* Desktop Right Side Actions */}
        {rightActions && (
          <div className="hidden md:flex items-center gap-2 flex-wrap">
            {rightActions}
          </div>
        )}
      </div>

      {/* Mobile Bottom Sheet for Filters and Sort */}
      {isMobileSheetOpen && hasControls && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
          <div
            className="fixed inset-0"
            onClick={() => setIsMobileSheetOpen(false)}
          />
          <div className="relative z-10 w-full max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom duration-200">
            {/* Sheet Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">Filters & Sorting</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileSheetOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                aria-label="Close filters"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Dropdowns and Actions */}
            <div className="flex flex-col gap-3 py-1 [&>select]:w-full [&>select]:min-h-[44px] [&>select]:text-base [&>select]:rounded-xl [&>select]:border-slate-200 [&>select]:bg-slate-50 [&>select]:px-3.5 [&>div]:w-full">
              {children}
              {rightActions && (
                <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
                  {rightActions}
                </div>
              )}
            </div>

            {/* Apply & Close Button */}
            <div className="pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => setIsMobileSheetOpen(false)}
                className="w-full min-h-[44px] rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-md hover:bg-blue-700 transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilterBar;

