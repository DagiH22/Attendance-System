import React, { useState } from "react";
import { AxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import MemberForm, { type MemberFormValues } from "../components/MemberForm";

const initialFormState: MemberFormValues = {
  name: "",
  email: "",
  phoneNumber: "",
  department: "",
  batch: "",
  campus: "",
  isActive: true,
};

const RegisterMemberPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const handleSubmit = async (normalizedForm: MemberFormValues) => {
    setIsSubmitting(true);
    setSubmitError("");

    try {
      await api.post("/members", {
        name: normalizedForm.name,
        email: normalizedForm.email,
        phoneNumber: normalizedForm.phoneNumber,
        department: normalizedForm.department,
        batch: normalizedForm.batch,
        campus: normalizedForm.campus,
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
      setSubmitError(
        axiosError.response?.data?.error ||
          axiosError.response?.data?.message ||
          "We couldn't register the member right now. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
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

        <MemberForm
          mode="create"
          initialValues={initialFormState}
          submitting={isSubmitting}
          submitError={submitError}
          onCancel={() => navigate("/members")}
          onSubmit={handleSubmit}
          fixedBottom={false}
        />
      </div>
    </div>
  );
};

export default RegisterMemberPage;
