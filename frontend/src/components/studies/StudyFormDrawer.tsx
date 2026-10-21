import React, { useState, useEffect } from "react";
import { RightDrawer } from "../shared/RightDrawer";
import type { Study, AudienceType } from "../../types/events";
import { createStudy, updateStudy } from "../../lib/api";
import { AlertTriangle } from "lucide-react";

export interface StudyFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  studyToEdit?: Study | null;
  onSuccess: (savedStudy: Study) => void;
  hasExistingAttendance?: boolean;
}

const BATCH_OPTIONS = [
  { value: "FRESHMAN", label: "Freshman" },
  { value: "YEAR_2", label: "Year 2" },
  { value: "YEAR_3", label: "Year 3" },
  { value: "YEAR_4", label: "Year 4" },
  { value: "YEAR_5", label: "Year 5" },
  { value: "GRADUATE", label: "Graduate" },
];

export const StudyFormDrawer: React.FC<StudyFormDrawerProps> = ({
  isOpen,
  onClose,
  studyToEdit,
  onSuccess,
  hasExistingAttendance = false,
}) => {
  const isEditing = Boolean(studyToEdit);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("ALL");
  const [audienceBatches, setAudienceBatches] = useState<string[]>([]);
  const [requiredSessions, setRequiredSessions] = useState<number | "">("");
  const [defaultLateGraceMinutes, setDefaultLateGraceMinutes] = useState<number>(15);
  const [isActive, setIsActive] = useState<boolean>(true);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showAudienceConfirm, setShowAudienceConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (studyToEdit) {
      setName(studyToEdit.name || "");
      setDescription(studyToEdit.description || "");
      setStartDate(studyToEdit.startDate ? studyToEdit.startDate.slice(0, 10) : "");
      setEndDate(studyToEdit.endDate ? studyToEdit.endDate.slice(0, 10) : "");
      setAudienceType(studyToEdit.audienceType || "ALL");
      setAudienceBatches(studyToEdit.audienceBatches || []);
      setRequiredSessions(studyToEdit.requiredSessions ?? "");
      setDefaultLateGraceMinutes(studyToEdit.defaultLateGraceMinutes ?? 15);
      setIsActive(studyToEdit.isActive ?? true);
    } else {
      setName("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      setAudienceType("ALL");
      setAudienceBatches([]);
      setRequiredSessions("");
      setDefaultLateGraceMinutes(15);
      setIsActive(true);
    }
    setErrors({});
    setIsDirty(false);
    setShowAudienceConfirm(false);
  }, [studyToEdit, isOpen]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Study name is required.";
    if (!startDate) errs.startDate = "Start date is required.";
    if (!endDate) errs.endDate = "End date is required.";
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errs.endDate = "End date cannot be earlier than start date.";
    }
    if (audienceType === "BATCHES" && audienceBatches.length === 0) {
      errs.audienceBatches = "Please select at least one batch for the audience.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleAudienceBatchToggle = (batch: string) => {
    setIsDirty(true);
    setAudienceBatches((prev) =>
      prev.includes(batch) ? prev.filter((b) => b !== batch) : [...prev, batch],
    );
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validate()) return;

    // Item 8: Confirmation if audience changes on a study with existing attendance
    if (
      isEditing &&
      hasExistingAttendance &&
      studyToEdit &&
      (studyToEdit.audienceType !== audienceType ||
        JSON.stringify(studyToEdit.audienceBatches.sort()) !==
          JSON.stringify(audienceBatches.sort())) &&
      !showAudienceConfirm
    ) {
      setShowAudienceConfirm(true);
      return;
    }

    try {
      setIsSaving(true);
      const payload: any = {
        name: name.trim(),
        description: description.trim() || null,
        startDate,
        endDate,
        audienceType,
        audienceBatches: audienceType === "BATCHES" ? audienceBatches : [],
        requiredSessions: requiredSessions === "" ? null : Number(requiredSessions),
        defaultLateGraceMinutes: Number(defaultLateGraceMinutes) || 15,
        isActive,
      };

      let result: Study;
      if (isEditing && studyToEdit) {
        const res = await updateStudy(studyToEdit.id, payload);
        result = res.study || res;
      } else {
        const res = await createStudy(payload);
        result = res.study || res;
      }

      onSuccess(result);
      onClose();
    } catch (err: any) {
      setErrors({
        submit: err.response?.data?.error || err.message || "Failed to save study.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <RightDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Study Details" : "Create New Study"}
      subtitle={
        isEditing
          ? "Update curriculum, audience eligibility, and grace periods"
          : "Define a study program, course series, or seasonal cluster"
      }
      onSave={handleSubmit}
      saveLabel={isEditing ? "Update Study" : "Create Study"}
      isSaving={isSaving}
      isDirty={isDirty}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errors.submit && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-800">
            {errors.submit}
          </div>
        )}

        {/* Confirmation Banner for Audience Modification */}
        {showAudienceConfirm && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
            <div className="flex items-center gap-2 font-bold text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Audience Eligibility Change Notice</span>
            </div>
            <p>
              This study already has recorded attendance. Changing the audience eligibility will
              recompute participant eligibility and statistics. Existing attendance logs will NOT
              be deleted.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowAudienceConfirm(false);
                  void handleSubmit();
                }}
                className="rounded-xl bg-amber-600 px-3 py-1.5 font-bold text-white hover:bg-amber-700"
              >
                Confirm & Recompute
              </button>
              <button
                type="button"
                onClick={() => setShowAudienceConfirm(false)}
                className="rounded-xl border border-amber-300 px-3 py-1.5 font-medium text-amber-800 hover:bg-amber-100"
              >
                Go Back
              </button>
            </div>
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
            Study Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setIsDirty(true);
            }}
            placeholder="e.g., Summer Course Series"
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {errors.name && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.name}</p>}
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setIsDirty(true);
            }}
            rows={2}
            placeholder="Provide context on topics covered..."
            className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Start Date *
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setIsDirty(true);
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.startDate && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.startDate}</p>}
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              End Date *
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setIsDirty(true);
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {errors.endDate && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.endDate}</p>}
          </div>
        </div>

        {/* Audience Type Selection */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
            Target Audience
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { type: "ALL" as AudienceType, label: "Everyone", desc: "All members" },
              { type: "FINAL_YEAR" as AudienceType, label: "Final-Year", desc: "Graduating class" },
              { type: "BATCHES" as AudienceType, label: "Specific Batches", desc: "Custom cohort" },
            ].map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => {
                  setAudienceType(opt.type);
                  setIsDirty(true);
                }}
                className={`rounded-2xl border p-3 text-left transition ${
                  audienceType === opt.type
                    ? "border-blue-600 bg-blue-50/70 text-blue-900 shadow-sm"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                }`}
              >
                <div className="text-xs font-bold">{opt.label}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Specific Batches Select (if BATCHES selected) */}
        {audienceType === "BATCHES" && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
            <span className="text-xs font-bold text-slate-700">Select Eligible Batches:</span>
            <div className="flex flex-wrap gap-2 pt-1">
              {BATCH_OPTIONS.map((b) => {
                const selected = audienceBatches.includes(b.value);
                return (
                  <button
                    key={b.value}
                    type="button"
                    onClick={() => handleAudienceBatchToggle(b.value)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition border ${
                      selected
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
            {errors.audienceBatches && (
              <p className="text-xs text-rose-600 font-medium">{errors.audienceBatches}</p>
            )}
          </div>
        )}

        {/* Required Sessions & Late Grace Minutes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Required Sessions (for completion)
            </label>
            <input
              type="number"
              min="0"
              value={requiredSessions}
              onChange={(e) => {
                setRequiredSessions(e.target.value === "" ? "" : Number(e.target.value));
                setIsDirty(true);
              }}
              placeholder="e.g., 8 (optional)"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Lateness Grace Default (Minutes)
            </label>
            <input
              type="number"
              min="0"
              max="120"
              value={defaultLateGraceMinutes}
              onChange={(e) => {
                setDefaultLateGraceMinutes(Number(e.target.value));
                setIsDirty(true);
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Active / Inactive Flag */}
        <div className="flex items-center gap-3 pt-2">
          <input
            type="checkbox"
            id="study-is-active"
            checked={isActive}
            onChange={(e) => {
              setIsActive(e.target.checked);
              setIsDirty(true);
            }}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="study-is-active" className="text-xs font-bold text-slate-800 cursor-pointer">
            Study is Active (visible in primary active views)
          </label>
        </div>
      </form>
    </RightDrawer>
  );
};

export default StudyFormDrawer;
