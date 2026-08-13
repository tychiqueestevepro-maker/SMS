import type { Metadata } from "next";
import Link from "next/link";

import { updatePasswordAction } from "@/app/(auth)/actions";
import { AuthCard } from "@/components/auth/auth-card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Choose a new password" };

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { error } = await searchParams;

  return (
    <AuthCard
      description="Choose a secure password for your Riink account."
      eyebrow="Account recovery"
      footer={
        <Link
          className="font-semibold text-[#246b4a] hover:text-[#19543a]"
          href="/login"
        >
          Back to sign in
        </Link>
      }
      title="Choose a new password"
    >
      <FormMessage error={error} />
      <form action={updatePasswordAction} className="space-y-5">
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-[#344139]"
            htmlFor="password"
          >
            New password
          </label>
          <input
            autoComplete="new-password"
            autoFocus
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="password"
            maxLength={128}
            minLength={8}
            name="password"
            required
            type="password"
          />
        </div>
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-[#344139]"
            htmlFor="passwordConfirmation"
          >
            Confirm new password
          </label>
          <input
            autoComplete="new-password"
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="passwordConfirmation"
            maxLength={128}
            minLength={8}
            name="passwordConfirmation"
            required
            type="password"
          />
        </div>
        <SubmitButton pendingLabel="Updating password…">
          Update password
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
