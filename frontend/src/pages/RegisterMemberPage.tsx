import React, { useMemo, useState } from "react";
import { AxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import Dropdown from "../components/Dropdown";

type DepartmentOption =
  | ""
  | "BIO"
  | "CHEM"
  | "CS"
  | "GEO"
  | "STAT"
  | "MATH"
  | "PHY"
  | "IS"
  | "ENGINEERING"
  | "FRESHMAN";

type BatchOption = "" | "FRESHMAN" | "YEAR_2" | "YEAR_3" | "YEAR_4" | "YEAR_5";
type CampusOption = "" | "FOUR_KILO" | "FIVE_KILO" | "SIX_KILO";

type FormState = {
  name: string;
  email: string;
  phoneNumber: string;
  department: DepartmentOption;
  batch: BatchOption;
  campus: CampusOption;
};

type FormErrors = Partial<Record<keyof FormState | "form", string>>;

const departmentOptions: Exclude<DepartmentOption, "">[] = [
  "BIO",
  "CHEM",
  "CS",
  "GEO",
  "STAT",
  "MATH",
  "PHY",
  "IS",
  "ENGINEERING",
  "FRESHMAN",
];

const batchOptions: Exclude<BatchOption, "">[] = [
  "FRESHMAN",
  "YEAR_2",
  "YEAR_3",
  "YEAR_4",
  "YEAR_5",
];

const campusOptions: Exclude<CampusOption, "">[] = [
  "FOUR_KILO",
  "FIVE_KILO",
  "SIX_KILO",
];

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

const initialFormState: FormState = {
  name: "",
  email: "",
  phoneNumber: "",
  department: "",
  batch: "",
  campus: "",
};

const RegisterMemberPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isFreshmanDepartment = form.department === "FRESHMAN";

  const helperText = useMemo(() => {
    if (isFreshmanDepartment) {
      return "Batch is locked to Freshman when department is Freshman.";
    }

    return "Select the member's current batch.";
  }, [isFreshmanDepartment]);

  const validate = (values: FormState): FormErrors => {
    const nextErrors: FormErrors = {};

    if (!values.name.trim()) {
      nextErrors.name = "Name is required.";
    }

    if (!values.email.trim()) {
      nextErrors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!values.phoneNumber.trim()) {
      nextErrors.phoneNumber = "Phone Number is required.";
    }

    if (values.department === "FRESHMAN" && values.batch !== "FRESHMAN") {
      nextErrors.batch =
        "Freshman department members must have Freshman batch.";
    }

    return nextErrors;
  };

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setForm((prev) => {
      const nextForm = {
        ...prev,
        [name]: value,
      } as FormState;

      if (name === "department") {
        if (value === "FRESHMAN") {
          nextForm.batch = "FRESHMAN";
        } else if (prev.batch === "FRESHMAN") {
          nextForm.batch = "";
        }
      }

      return nextForm;
    });

    setErrors((prev) => ({ ...prev, [name]: undefined, form: undefined }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedForm: FormState = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim(),
      batch: isFreshmanDepartment ? "FRESHMAN" : form.batch,
    };

    const validationErrors = validate(normalizedForm);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      await api.post("/members", {
        name: normalizedForm.name,
        email: normalizedForm.email,
        phoneNumber: normalizedForm.phoneNumber,
        department: normalizedForm.department || undefined,
        batch: normalizedForm.batch || undefined,
        campus: normalizedForm.campus || undefined,
      });

      navigate("/members", {
        replace: true,
        state: { registered: true },
      });
    } catch (error) {
      const axiosError = error as AxiosError<{
        error?: string;
        message?: string;
      }>;
      setErrors({
        form:
          axiosError.response?.data?.error ||
          axiosError.response?.data?.message ||
          "We couldn't register the member right now. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderFieldError = (field: keyof FormState) => {
    if (!errors[field]) {
      return null;
    }

    return <p className="mt-1 text-sm text-red-600">{errors[field]}</p>;
  };

  const dropdownOptions = {
    department: departmentOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
    })),
    batch: batchOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
      disabled: isFreshmanDepartment && option !== "FRESHMAN",
    })),
    campus: campusOptions.map((option) => ({
      label: formatEnumLabel(option),
      value: option,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/members")}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Back to members"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Register Member
            </h1>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
            <h2 className="text-lg font-semibold text-gray-900">
              Member details
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Fill in the member's information and submit to create their
              profile.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="px-5 py-5 sm:px-6"
          >
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleChange}
                  placeholder="Enter full name"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
                {renderFieldError("name")}
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="member@example.com"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
                {renderFieldError("email")}
              </div>

              <div>
                <label
                  htmlFor="phoneNumber"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Phone Number
                </label>
                <input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="text"
                  value={form.phoneNumber}
                  onChange={handleChange}
                  placeholder="09xxxxxxxx"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                />
                {renderFieldError("phoneNumber")}
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Dropdown
                    id="department"
                    label="Department"
                    placeholder="Select department"
                    value={form.department}
                    options={dropdownOptions.department}
                    onChange={(value) =>
                      handleChange({
                        target: { name: "department", value },
                      } as React.ChangeEvent<HTMLSelectElement>)
                    }
                    error={errors.department}
                  />
                </div>

                <div>
                  <Dropdown
                    id="batch"
                    label="Batch"
                    placeholder="Select batch"
                    value={form.batch}
                    options={dropdownOptions.batch}
                    onChange={(value) =>
                      handleChange({
                        target: { name: "batch", value },
                      } as React.ChangeEvent<HTMLSelectElement>)
                    }
                    helperText={helperText}
                    error={errors.batch}
                  />
                </div>

                <div>
                  <Dropdown
                    id="campus"
                    label="Campus"
                    placeholder="Select campus"
                    value={form.campus}
                    options={dropdownOptions.campus}
                    onChange={(value) =>
                      handleChange({
                        target: { name: "campus", value },
                      } as React.ChangeEvent<HTMLSelectElement>)
                    }
                    error={errors.campus}
                  />
                </div>
              </div>

              {errors.form && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errors.form}
                </div>
              )}
            </div>

            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-4 backdrop-blur sm:left-auto sm:right-auto sm:mx-auto sm:max-w-3xl sm:rounded-t-3xl sm:px-6">
              <div className="pointer-events-auto flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/members")}
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {isSubmitting ? "Registering..." : "Register Member"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegisterMemberPage;
