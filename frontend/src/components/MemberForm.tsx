import React, { useEffect, useState } from "react";
import Dropdown from "./Dropdown";

export type BatchOption =
  | ""
  | "FRESHMAN"
  | "YEAR_2"
  | "YEAR_3"
  | "YEAR_4"
  | "YEAR_5"
  | "GRADUATE";

export type CampusOption = "" | "FOUR_KILO" | "FIVE_KILO" | "SIX_KILO" | "ART";
export type GenderOption = "" | "MALE" | "FEMALE";

export type MemberFormValues = {
  name: string;
  email: string;
  phoneNumber: string;
  department: string;
  batch: BatchOption;
  campus: CampusOption;
  gender: GenderOption;
  isActive: boolean;
};

export type MemberFormErrors = Partial<
  Record<keyof MemberFormValues | "form", string>
>;

type MemberFormProps = {
  mode: "create" | "edit";
  initialValues: MemberFormValues;
  submitting: boolean;
  submitError?: string;
  onCancel: () => void;
  onSubmit: (values: MemberFormValues) => Promise<void>;
  fixedBottom?: boolean;
};

const batchOptions: Exclude<BatchOption, "">[] = [
  "FRESHMAN",
  "YEAR_2",
  "YEAR_3",
  "YEAR_4",
  "YEAR_5",
  "GRADUATE",
];

const campusOptions: Exclude<CampusOption, "">[] = [
  "FOUR_KILO",
  "FIVE_KILO",
  "SIX_KILO",
  "ART",
];

const genderOptions: Exclude<GenderOption, "">[] = ["MALE", "FEMALE"];

const campusLabels: Record<Exclude<CampusOption, "">, string> = {
  FOUR_KILO: "4 Kilo",
  FIVE_KILO: "5 Kilo",
  SIX_KILO: "6 Kilo",
  ART: "Art",
};

const fourKiloDepartmentOptions = [
  "BIO",
  "CHEM",
  "CS",
  "GEO",
  "STAT",
  "MATH",
  "PHY",
  "IS",
  "FRESHMAN",
] as const;

const batchOptionsByCampus: Record<Exclude<CampusOption, "">, BatchOption[]> = {
  FOUR_KILO: ["FRESHMAN", "YEAR_2", "YEAR_3", "YEAR_4", "GRADUATE"],
  FIVE_KILO: [
    "FRESHMAN",
    "YEAR_2",
    "YEAR_3",
    "YEAR_4",
    "YEAR_5",
    "GRADUATE",
  ],
  SIX_KILO: ["FRESHMAN", "YEAR_2", "YEAR_3", "YEAR_4", "GRADUATE"],
  ART: ["FRESHMAN", "YEAR_2", "YEAR_3", "YEAR_4", "GRADUATE"],
};

const formatEnumLabel = (value: string) =>
  value
    .split("_")
    .map((segment) => {
      if (/^\d+$/.test(segment)) {
        return segment;
      }

      return segment.charAt(0) + segment.slice(1).toLowerCase();
    })
    .join(" ");

export const validateMemberForm = (
  values: MemberFormValues,
): MemberFormErrors => {
  const nextErrors: MemberFormErrors = {};

  if (!values.name.trim()) {
    nextErrors.name = "Name is required.";
  }

  if (!values.email.trim()) {
    nextErrors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    nextErrors.email = "Enter a valid email address.";
  }

  if (!values.phoneNumber.trim()) {
    nextErrors.phoneNumber = "Phone number is required";
  } else if (!/^\+?[0-9]{10,13}$/.test(values.phoneNumber.trim())) {
    nextErrors.phoneNumber =
      "Use only digits or +, with 10 digits locally or 13 characters with +251.";
  } else if (![10, 13].includes(values.phoneNumber.trim().length)) {
    nextErrors.phoneNumber =
      "Phone number must be 10 digits locally or 13 characters with +251.";
  }

  if (!values.campus) {
    nextErrors.campus = "Campus must be selected";
  }

  if (!values.department.trim()) {
    nextErrors.department = "Department must be selected";
  }

  if (!values.batch) {
    nextErrors.batch = "Batch must be selected";
  }

  if (!values.gender) {
    nextErrors.gender = "Gender is required";
  }

  return nextErrors;
};

export const normalizeMemberFormValues = (
  values: MemberFormValues,
): MemberFormValues => ({
  ...values,
  name: values.name.trim(),
  email: values.email.trim(),
  phoneNumber: values.phoneNumber.trim(),
  department: values.department.trim(),
});

const MemberForm: React.FC<MemberFormProps> = ({
  mode,
  initialValues,
  submitting,
  submitError,
  onCancel,
  onSubmit,
  fixedBottom = true,
}) => {
  const [form, setForm] = useState<MemberFormValues>(initialValues);
  const [errors, setErrors] = useState<MemberFormErrors>({});

  const isCampusSelected = Boolean(form.campus);
  const usesDropdownDepartment = form.campus === "FOUR_KILO";
  const departmentIsFreshman =
    form.department.trim().toUpperCase() === "FRESHMAN";
  const availableBatchOptions = form.campus
    ? batchOptionsByCampus[form.campus]
    : [];

  useEffect(() => {
    setForm(initialValues);
  }, [initialValues]);

  useEffect(() => {
    setForm((prev) => {
      if (!prev.campus) {
        return prev.batch === "" && prev.department === ""
          ? prev
          : { ...prev, department: "", batch: "" };
      }

      const allowedBatches = batchOptionsByCampus[prev.campus];
      const nextDepartment = usesDropdownDepartment
        ? fourKiloDepartmentOptions.includes(
            prev.department as (typeof fourKiloDepartmentOptions)[number],
          )
          ? prev.department
          : ""
        : prev.department;

      let nextBatch = prev.batch;

      if (nextDepartment.trim().toUpperCase() === "FRESHMAN") {
        nextBatch = "FRESHMAN";
      } else if (nextBatch && !allowedBatches.includes(nextBatch)) {
        nextBatch = "";
      }

      if (nextDepartment === prev.department && nextBatch === prev.batch) {
        return prev;
      }

      return {
        ...prev,
        department: nextDepartment,
        batch: nextBatch,
      };
    });
  }, [form.campus, usesDropdownDepartment]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]:
        type === "checkbox" ? checked : name === "department" ? value : value,
    }));

    setErrors((prev) => ({ ...prev, [name]: undefined, form: undefined }));
  };

  const handleSelectChange = (
    field: "batch" | "campus" | "gender",
    value: string,
  ) => {
    setForm((prev) => {
      if (field === "campus") {
        return {
          ...prev,
          campus: value as CampusOption,
          department: "",
          batch: "",
        };
      }

      if (field === "batch") {
        return {
          ...prev,
          batch: value as BatchOption,
        };
      }

      return {
        ...prev,
        [field]: value,
      } as MemberFormValues;
    });

    setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = normalizeMemberFormValues(form);
    const validationErrors = validateMemberForm(normalized);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    await onSubmit(normalized);
  };

  const dropdownOptions = {
    department: fourKiloDepartmentOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
    })),
    batch: batchOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
      disabled:
        !availableBatchOptions.includes(option) ||
        (departmentIsFreshman && option !== "FRESHMAN"),
    })),
    campus: campusOptions.map((option) => ({
      label: campusLabels[option],
      value: option,
    })),
    gender: genderOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
    })),
  };

  return (
    <div className="rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
        <h2 className="text-lg font-semibold text-gray-900">Member details</h2>
        <p className="mt-1 text-sm text-gray-500">
          {mode === "create"
            ? "Fill in the member's information and submit to create their profile."
            : "Update the member's details and save your changes."}
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="px-5 py-5 sm:px-6">
        <div className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleInputChange}
              placeholder="Enter full name"
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleInputChange}
              placeholder="member@example.com"
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            {errors.email && (
              <p className="mt-1 text-sm text-red-600">{errors.email}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="phoneNumber"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              id="phoneNumber"
              name="phoneNumber"
              type="text"
              value={form.phoneNumber}
              onChange={handleInputChange}
              placeholder="09xxxxxxxx"
              className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
            />
            {errors.phoneNumber && (
              <p className="mt-1 text-sm text-red-600">{errors.phoneNumber}</p>
            )}
          </div>

          <div>
            <Dropdown
              id="gender"
              label="Gender"
              required
              placeholder="Select gender"
              value={form.gender}
              options={dropdownOptions.gender}
              onChange={(value) => handleSelectChange("gender", value)}
              error={errors.gender}
            />
          </div>

          <div>
            <Dropdown
              id="campus"
              label="Campus"
              required
              placeholder="Select campus"
              value={form.campus}
              options={dropdownOptions.campus}
              onChange={(value) => handleSelectChange("campus", value)}
              error={errors.campus}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {usesDropdownDepartment ? (
                <Dropdown
                  id="department"
                  label="Department"
                  required
                  placeholder={
                    isCampusSelected
                      ? "Select department"
                      : "Select campus first"
                  }
                  value={form.department}
                  options={dropdownOptions.department}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      department: value,
                      batch: value === "FRESHMAN" ? "FRESHMAN" : "",
                    }))
                  }
                  error={errors.department}
                  disabled={!isCampusSelected}
                  helperText={
                    !isCampusSelected
                      ? "Choose a campus to enable department."
                      : undefined
                  }
                />
              ) : (
                <>
                  <label
                    htmlFor="department"
                    className="mb-2 block text-sm font-medium text-gray-700"
                  >
                    Department <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="department"
                    name="department"
                    type="text"
                    value={form.department}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setForm((prev) => ({
                        ...prev,
                        department: nextValue,
                        batch:
                          nextValue.trim().toUpperCase() === "FRESHMAN"
                            ? "FRESHMAN"
                            : prev.batch === "FRESHMAN"
                              ? ""
                              : prev.batch,
                      }));
                      setErrors((prev) => ({
                        ...prev,
                        department: undefined,
                        form: undefined,
                      }));
                    }}
                    placeholder={
                      isCampusSelected
                        ? "Enter department"
                        : "Select campus first"
                    }
                    disabled={!isCampusSelected}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {!isCampusSelected && (
                    <p className="mt-1 text-sm text-gray-500">
                      Choose a campus to enable department.
                    </p>
                  )}
                  {errors.department && (
                    <p className="mt-1 text-sm text-red-600">
                      {errors.department}
                    </p>
                  )}
                </>
              )}
            </div>

            <div>
              <Dropdown
                id="batch"
                label="Batch"
                required
                placeholder={
                  isCampusSelected ? "Select batch" : "Select campus first"
                }
                value={form.batch}
                options={dropdownOptions.batch.filter((option) =>
                  availableBatchOptions.includes(option.value as BatchOption),
                )}
                onChange={(value) => handleSelectChange("batch", value)}
                error={errors.batch}
                disabled={!isCampusSelected || departmentIsFreshman}
                helperText={
                  !isCampusSelected
                    ? "Choose a campus to enable batch."
                    : departmentIsFreshman
                      ? "Batch is locked to Freshman when department is Freshman."
                      : undefined
                }
              />
            </div>

            <div className="hidden sm:block" />
          </div>

          {mode === "edit" && (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Status
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((prev) => ({ ...prev, isActive: !prev.isActive }))
                }
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                  form.isActive
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                <span>{form.isActive ? "Active" : "Inactive"}</span>
                <span className="text-xs uppercase tracking-wide">
                  Tap to switch
                </span>
              </button>
            </div>
          )}

          {(errors.form || submitError) && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errors.form || submitError}
            </div>
          )}
        </div>

        {fixedBottom ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:left-auto sm:right-auto sm:mx-auto sm:max-w-3xl sm:rounded-t-3xl sm:px-6">
            <div className="pointer-events-auto flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {submitting
                  ? mode === "create"
                    ? "Registering..."
                    : "Saving..."
                  : mode === "create"
                    ? "Register Member"
                    : "Save Changes"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow transition hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting
                ? mode === "create"
                  ? "Registering..."
                  : "Saving..."
                : mode === "create"
                  ? "Register Member"
                  : "Save Changes"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
};

export default MemberForm;
