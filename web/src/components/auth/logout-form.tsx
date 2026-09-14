"use client";

import { logoutAction } from "@/server/actions/auth";

const REMEMBER_EMAIL_KEY = "agenttender_remember_email";
const REMEMBER_FLAG_KEY = "agenttender_remember_me";

function clearRememberedLogin() {
  try {
    localStorage.removeItem(REMEMBER_FLAG_KEY);
    localStorage.removeItem(REMEMBER_EMAIL_KEY);
  } catch {
    // Ignore storage access errors (private mode, etc.)
  }
}

/**
 * Hidden logout form that clears Remember Me local storage before ending the session.
 */
export function LogoutForm() {
  return (
    <form
      id="logout-form"
      action={logoutAction}
      className="hidden"
      aria-hidden
      onSubmit={clearRememberedLogin}
    />
  );
}
