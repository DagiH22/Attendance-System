import React, { useEffect } from "react";
import { X, Loader2 } from "lucide-react";

export interface RightDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onSave?: (e: React.FormEvent) => void | Promise<void>;
  saveLabel?: string;
  cancelLabel?: string;
  isSaving?: boolean;
  isSaveDisabled?: boolean;
  isDirty?: boolean;
  footerActions?: React.ReactNode;
  widthClass?: string;
}

export const RightDrawer: React.FC<RightDrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  onSave,
  saveLabel = "Save Changes",
  cancelLabel = "Cancel",
  isSaving = false,
  isSaveDisabled = false,
  isDirty = false,
  footerActions,
  widthClass = "sm:max-w-xl md:max-w-2xl",
}) => {
  const handleRequestClose = () => {
    if (isDirty) {
      const confirmDiscard = window.confirm(
        "You have unsaved changes. Are you sure you want to close and discard them?",
      );
      if (!confirmDiscard) return;
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        handleRequestClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isDirty]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={handleRequestClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer */}
      <div
        className={`relative z-10 flex h-full w-full ${widthClass} flex-col bg-white shadow-2xl transition-all duration-300 animate-in slide-in-from-right`}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4.5 bg-slate-50/50">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h2>
            {subtitle && (
              <p className="text-xs font-semibold text-slate-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>

        {/* Drawer Footer */}
        <div className="border-t border-slate-200 px-6 py-4 bg-slate-50/60 flex items-center justify-between gap-3">
          <div>{footerActions}</div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isSaving}
              onClick={handleRequestClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            {onSave && (
              <button
                type="button"
                disabled={isSaving || isSaveDisabled}
                onClick={onSave}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 transition disabled:opacity-50 active:scale-[0.98]"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{saveLabel}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RightDrawer;
