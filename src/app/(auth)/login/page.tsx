import type { Metadata } from "next";
import Link from "next/link";

import { loginAction } from "@/app/(auth)/actions";
import { AuthCard } from "@/components/auth/auth-card";
import { FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";

export const metadata: Metadata = { title: "Sign in" };

type LoginPageProps = {
  searchParams: Promise<{ error?: string; success?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, success } = await searchParams;

  return (
    <AuthCard
      description="Welcome back. Enter your details to continue."
      footer={
        <>
          New to Riink?{" "}
          <Link className="font-semibold text-[#246b4a] hover:text-[#19543a]" href="/signup">
            Create an account
          </Link>
        </>
      }
      title="Sign in to Riink"
    >
      <FormMessage error={error} success={success} />
      <form action={loginAction} className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#344139]" htmlFor="email">
            Email address
          </label>
          <input
            autoComplete="email"
            autoFocus
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm text-[#17211b] shadow-sm placeholder:text-[#9aa39d] hover:border-[#cbd5ce] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="email"
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-sm font-medium text-[#344139]" htmlFor="password">
              Password
            </label>
            <Link className="text-xs font-medium text-[#246b4a] hover:text-[#19543a]" href="/forgot-password">
              Forgot password?
            </Link>
          </div>
          <input
            autoComplete="current-password"
            className="h-11 w-full rounded-lg border border-[#dbe2dd] bg-white px-3.5 text-sm text-[#17211b] shadow-sm hover:border-[#cbd5ce] focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]"
            id="password"
            minLength={8}
            name="password"
            required
            type="password"
          />
        </div>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
