import React, { useState, useRef, useEffect } from "react";
import { Plus, ChevronDown, Calendar, BookOpen } from "lucide-react";

export interface NewSplitButtonProps {
  primaryLabel?: "New Session" | "New Study";
  onNewSession: () => void;
  onNewStudy: () => void;
  isSuperAdmin?: boolean;
}

export const NewSplitButton: React.FC<NewSplitButtonProps> = ({
  primaryLabel = "New Session",
  onNewSession,
  onNewStudy,
  isSuperAdmin = true,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePrimaryClick = () => {
    if (primaryLabel === "New Study") {
      onNewStudy();
    } else {
      onNewSession();
    }
  };

  return (
    <div className="relative inline-flex shadow-sm rounded-xl" ref={containerRef}>
      {/* Primary Action Button */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        className="inline-flex items-center gap-2 rounded-l-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:from-blue-700 hover:to-indigo-700 transition active:scale-[0.98]"
      >
        <Plus className="w-4 h-4" />
        <span>{primaryLabel}</span>
      </button>

      {/* Split Dropdown Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="More options"
        className="inline-flex items-center rounded-r-xl border-l border-blue-500/50 bg-indigo-600 px-2.5 py-2 text-white hover:bg-indigo-700 transition active:scale-[0.98]"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl bg-white p-1.5 shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-100">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              onNewSession();
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Calendar className="w-4 h-4" />
            </div>
            <div className="text-left">
              <div className="font-semibold text-slate-800">New Session</div>
              <div className="text-[11px] text-slate-500">Standalone or in study</div>
            </div>
          </button>

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNewStudy();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition mt-1"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <BookOpen className="w-4 h-4" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-slate-800">New Study</div>
                <div className="text-[11px] text-slate-500">Course or study series</div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default NewSplitButton;
