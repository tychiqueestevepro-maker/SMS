import type { Metadata } from "next";
import Link from "next/link";

import { forgotPasswordAction } from "@/app/(auth)/actions";
import { AuthCard } from "@/components/auth/auth-card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Reset password" };

type ForgotPasswordPageProps = {
  searchParams: Promise<{ error?: string; success?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { error, success } = await searchParams;

  return (
    <AuthCard
      description="Enter your account email and we'll send you a secure reset link."
      eyebrow="Account recovery"
      footer={
        <Link className="font-semibold text-[#246b4a] hover:text-[#19543a]" href="/login">
          Back to sign in
        </Link>
      }
      title="Reset your password"
    >
      <FormMessage error={error} success={success} />
      <form action={forgotPasswordAction} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="email">
            Email address
          </label>
          <input
            autoComplete="email"
            autoFocus
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm placeholder:text-[#9aa39d] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="email"
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
        </div>
        <SubmitButton pendingLabel="Sending link…">Send reset link</SubmitButton>
      </form>
    </AuthCard>
  );
}
