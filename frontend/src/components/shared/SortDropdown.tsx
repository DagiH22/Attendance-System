import React, { useState, useRef, useEffect } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronDown } from "lucide-react";

export interface SortOptionItem {
  value: string;
  label: string;
}

export interface SortDropdownProps {
  value: string;
  direction?: "asc" | "desc";
  options: SortOptionItem[];
  onChange: (value: string) => void;
  onDirectionToggle?: () => void;
  className?: string;
}

export const SortDropdown: React.FC<SortDropdownProps> = ({
  value,
  direction = "asc",
  options,
  onChange,
  onDirectionToggle,
  className = "",
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

  const currentOption = options.find((o) => o.value === value) || options[0];

  return (
    <div className={`relative inline-flex items-center gap-1.5 ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
      >
        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
        <span>Sort: <span className="text-slate-900 font-bold">{currentOption?.label}</span></span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
      </button>

      {onDirectionToggle && (
        <button
          type="button"
          onClick={onDirectionToggle}
          title={direction === "asc" ? "Ascending order (Click to switch to Descending)" : "Descending order (Click to switch to Ascending)"}
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-50 transition"
        >
          {direction === "asc" ? (
            <ArrowUp className="w-4 h-4 text-blue-600" />
          ) : (
            <ArrowDown className="w-4 h-4 text-indigo-600" />
          )}
        </button>
      )}

      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-2xl bg-white p-1.5 shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs sm:text-sm font-medium transition ${
                opt.value === value
                  ? "bg-blue-50 text-blue-700 font-bold"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SortDropdown;
