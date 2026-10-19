import React, { useState, useEffect } from "react";
import { RightDrawer } from "../shared/RightDrawer";
import MemberForm, { type MemberFormValues } from "../MemberForm";
import api from "../../lib/api";
import type { Member } from "../../types/members";

export interface MemberFormDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  memberToEdit?: Member | null;
  onSuccess: (savedMember: Member, isNew: boolean) => void;
}

const defaultValues: MemberFormValues = {
  name: "",
  email: "",
  phoneNumber: "",
  department: "",
  batch: "",
  campus: "",
  gender: "",
  isActive: true,
};

export const MemberFormDrawer: React.FC<MemberFormDrawerProps> = ({
  isOpen,
  onClose,
  memberToEdit,
  onSuccess,
}) => {
  const isEditing = Boolean(memberToEdit);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const [formValues, setFormValues] = useState<MemberFormValues>(defaultValues);

  useEffect(() => {
    if (memberToEdit) {
      setFormValues({
        name: memberToEdit.name,
        email: memberToEdit.email,
        phoneNumber: memberToEdit.phoneNumber || "",
        department: memberToEdit.department || "",
        batch: (memberToEdit.batch as any) || "",
        campus: (memberToEdit.campus as any) || "",
        gender: (memberToEdit.gender as any) || "",
        isActive: memberToEdit.isActive ?? true,
      });
    } else {
      setFormValues(defaultValues);
    }
    setSubmitError("");
    setIsDirty(false);
  }, [memberToEdit, isOpen]);

  const handleSubmit = async (values: MemberFormValues) => {
    try {
      setSubmitting(true);
      setSubmitError("");

      const payload = {
        name: values.name.trim(),
        email: values.email.trim(),
        phoneNumber: values.phoneNumber.trim(),
        department: values.department.trim(),
        batch: values.batch,
        campus: values.campus,
        gender: values.gender,
        isActive: values.isActive,
      };

      if (isEditing && memberToEdit) {
        const res = await api.put(`/members/${memberToEdit.id}`, payload);
        const updated = res.data?.member ?? res.data;
        onSuccess(updated, false);
      } else {
        const res = await api.post("/members", payload);
        const created = res.data?.member ?? res.data;
        onSuccess(created, true);
      }
      onClose();
    } catch (err: any) {
      setSubmitError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          "Failed to save member.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RightDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Member Profile" : "Register New Member"}
      subtitle={
        isEditing
          ? "Update contact info, academic department, and enrollment status"
          : "Add an individual member, generate their QR code, and assign academic cohort"
      }
      isSaving={submitting}
      isDirty={isDirty}
    >
      <div className="-mt-2">
        <MemberForm
          key={memberToEdit?.id ?? "new"}
          mode={isEditing ? "edit" : "create"}
          initialValues={formValues}
          submitting={submitting}
          submitError={submitError}
          onCancel={onClose}
          onSubmit={handleSubmit}
          fixedBottom={false}
        />
      </div>
    </RightDrawer>
  );
};

export default MemberFormDrawer;
