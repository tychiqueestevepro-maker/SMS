import type { Metadata } from "next";
import Link from "next/link";

import { signupAction } from "@/app/(auth)/actions";
import { AuthCard } from "@/components/auth/auth-card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Create account" };

type SignupPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error } = await searchParams;

  return (
    <AuthCard
      description="Start organizing your outreach in one focused workspace."
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-semibold text-[#246b4a] hover:text-[#19543a]" href="/login">
            Sign in
          </Link>
        </>
      }
      title="Create your account"
    >
      <FormMessage error={error} />
      <form action={signupAction} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="fullName">
            Full name
          </label>
          <input
            autoComplete="name"
            autoFocus
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm placeholder:text-[#9aa39d] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="fullName"
            name="fullName"
            placeholder="Alex Morgan"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="email">
            Work email
          </label>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm placeholder:text-[#9aa39d] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="email"
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="password">
            Password
          </label>
          <input
            aria-describedby="password-help"
            autoComplete="new-password"
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm shadow-sm focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="password"
            minLength={8}
            name="password"
            required
            type="password"
          />
          <p className="mt-1.5 text-xs text-[#7a857e]" id="password-help">
            Use at least 8 characters.
          </p>
        </div>
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
