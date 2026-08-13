"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";

import { getApplicationOrigin } from "@/lib/application-url";
import { createClient } from "@/lib/supabase/server";

const emailSchema = z.string().trim().email();
const passwordSchema = z.string().min(8).max(128);

function destination(path: string, key: "error" | "success", value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}` as Route;
}

export async function loginAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));

  if (!email.success || !password.success) {
    redirect(destination("/login", "error", "Enter a valid email and password."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: password.data,
  });

  if (error) {
    const message = error.message.toLowerCase().includes("confirm")
      ? "Confirm your email before signing in."
      : "Email or password is incorrect.";
    redirect(destination("/login", "error", message));
  }

  redirect("/campaigns");
}

export async function signupAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));
  const fullName = z.string().trim().min(2).max(100).safeParse(formData.get("fullName"));

  if (!email.success || !password.success || !fullName.success) {
    redirect(destination("/signup", "error", "Complete every field with valid information."));
  }

  const supabase = await createClient();
  const origin = getApplicationOrigin();
  const { error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { full_name: fullName.data },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect(destination("/signup", "error", "We couldn't create your account. Please try again."));
  }

  redirect(destination("/login", "success", "Check your inbox to confirm your email."));
}

export async function forgotPasswordAction(formData: FormData) {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) {
    redirect(destination("/forgot-password", "error", "Enter a valid email address."));
  }

  const supabase = await createClient();
  const origin = getApplicationOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    redirect(destination("/forgot-password", "error", "We couldn't send the email. Please try again shortly."));
  }

  redirect(
    destination(
      "/forgot-password",
      "success",
      "If an account exists for this email, you'll receive a reset link shortly.",
    ),
  );
}

export async function updatePasswordAction(formData: FormData) {
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmation = passwordSchema.safeParse(
    formData.get("passwordConfirmation"),
  );

  if (
    !password.success ||
    !confirmation.success ||
    password.data !== confirmation.data
  ) {
    redirect(
      destination(
        "/reset-password",
        "error",
        "Enter matching passwords with at least 8 characters.",
      ),
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      destination(
        "/login",
        "error",
        "This password reset link is invalid or has expired.",
      ),
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: password.data,
  });
  if (error) {
    redirect(
      destination(
        "/reset-password",
        "error",
        "We couldn't update your password. Request a new reset link and try again.",
      ),
    );
  }

  await supabase.auth.signOut();
  redirect(
    destination(
      "/login",
      "success",
      "Password updated. Sign in with your new password.",
    ),
  );
}
