import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../lib/api";
import MemberForm, { type MemberFormValues } from "../components/MemberForm";
import { toFriendlyError } from "../lib/errors";

const emptyValues: MemberFormValues = {
  name: "",
  email: "",
  phoneNumber: "",
  department: "",
  batch: "",
  campus: "",
  gender: "",
  isActive: true,
};

const EditMemberPage: React.FC = () => {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const [memberValues, setMemberValues] =
    useState<MemberFormValues>(emptyValues);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchMember = async () => {
      if (!memberId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const response = await api.get(`/members/${memberId}`);
        const member = response.data?.member ?? response.data;

        setMemberValues({
          name: member.name ?? "",
          email: member.email ?? "",
          phoneNumber: member.phoneNumber ?? "",
          department: member.department ?? "",
          batch: member.batch ?? "",
          campus: member.campus ?? "",
          gender: member.gender ?? "",
          isActive:
            typeof member.isActive === "boolean" ? member.isActive : true,
        });
      } catch (error) {
        const friendly = toFriendlyError(error, {
          action: "load the member details",
          fallbackTitle: "Couldn't load member",
          fallbackMessage: "Please refresh the page and try again.",
        });
        setSubmitError(friendly.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMember();
  }, [memberId]);

  const title = useMemo(
    () => memberValues.name || "Edit Member",
    [memberValues.name],
  );

  const handleSubmit = async (values: MemberFormValues) => {
    if (!memberId) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const payload: Record<string, unknown> = {
        name: values.name,
        email: values.email,
        phoneNumber: values.phoneNumber,
        department: values.department,
        batch: values.batch,
        campus: values.campus,
        isActive: values.isActive,
        gender: values.gender,
      };

      await api.put(`/members/${memberId}`, payload);

      navigate(`/members/${memberId}`, {
        replace: true,
        state: { updated: true },
      });
    } catch (error) {
      const friendly = toFriendlyError(error, {
        action: "update the member",
        fallbackTitle: "Update failed",
        fallbackMessage: "Please try again.",
      });
      setSubmitError(friendly.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="h-12 w-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/members/${memberId}`)}
            className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Back to member details"
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
            <h1 className="text-2xl font-bold text-gray-900">Edit Member</h1>
            <p className="text-sm text-gray-500">{title}</p>
          </div>
        </div>

        <MemberForm
          mode="edit"
          initialValues={memberValues}
          submitting={isSubmitting}
          submitError={submitError}
          onCancel={() => navigate(`/members/${memberId}`)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
};

export default EditMemberPage;
