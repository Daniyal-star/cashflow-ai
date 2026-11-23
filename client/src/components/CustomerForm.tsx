import { useState, type FormEvent } from "react";
import { createCustomer, updateCustomer } from "../api/client";
import type { CustomerInput, CustomerView } from "../../../shared/types";

export const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-teal-500 focus:outline-none";
export const LABEL_CLASS = "block text-xs font-medium uppercase tracking-wide text-slate-400";
export const FIELD_ERROR_CLASS = "mt-1 text-xs text-red-400";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  /** When provided the form edits this customer; otherwise it creates one. */
  customer?: CustomerView | null;
  onSaved: () => void;
  onCancel: () => void;
}

interface FieldErrors {
  name?: string;
  email?: string;
}

export default function CustomerForm({ customer, onSaved, onCancel }: Props) {
  const isEdit = Boolean(customer);
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = "Name is required.";
    if (email.trim() && !EMAIL_PATTERN.test(email.trim())) next.email = "Enter a valid email address.";
    return next;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    setSubmitting(true);
    try {
      if (isEdit && customer) {
        // On edit, an empty optional field is sent as "" so it can be cleared.
        const input: Partial<CustomerInput> = {
          name: name.trim(),
          email: trimmedEmail,
          phone: trimmedPhone,
        };
        await updateCustomer(customer.id, input);
      } else {
        const input: CustomerInput = { name: name.trim() };
        if (trimmedEmail) input.email = trimmedEmail;
        if (trimmedPhone) input.phone = trimmedPhone;
        await createCustomer(input);
      }
      onSaved();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={isEdit ? "Edit customer" : "New customer"}>
      <h2 className="text-lg font-semibold text-slate-100">{isEdit ? "Edit customer" : "New customer"}</h2>

      {serverError && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {serverError}
        </p>
      )}

      <div>
        <label htmlFor="customer-name" className={LABEL_CLASS}>
          Name <span className="text-red-400">*</span>
        </label>
        <input
          id="customer-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? "customer-name-error" : undefined}
          className={INPUT_CLASS}
        />
        {errors.name && (
          <p id="customer-name-error" className={FIELD_ERROR_CLASS}>
            {errors.name}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="customer-email" className={LABEL_CLASS}>
          Email
        </label>
        <input
          id="customer-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "customer-email-error" : undefined}
          className={INPUT_CLASS}
        />
        {errors.email && (
          <p id="customer-email-error" className={FIELD_ERROR_CLASS}>
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="customer-phone" className={LABEL_CLASS}>
          Phone
        </label>
        <input
          id="customer-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-navy-700 px-4 py-2 text-sm text-slate-300 hover:bg-navy-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-navy-950 hover:bg-teal-400 disabled:opacity-60"
        >
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
        </button>
      </div>
    </form>
  );
}
