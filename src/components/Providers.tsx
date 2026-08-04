"use client";

import { SessionProvider, useSession, signIn } from "next-auth/react";
import { BrandMark } from "@/components/BrandMark";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

/** Blocks the app behind Slack sign-in when NEXT_PUBLIC_AUTH_ENABLED=true. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  if (!AUTH_ENABLED) return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center text-ink-faint text-sm">
        Loading…
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="flex h-screen flex-col items-center justify-center px-6">
        <div className="mb-3">
          <BrandMark size={34} />
        </div>
        <p className="text-ink-soft mb-8 text-center max-w-sm">
          Sign in with your Slack account — your conversations and the agent&apos;s memory of you
          carry over from Slack.
        </p>
        <button
          onClick={() => signIn("slack")}
          className="flex items-center gap-2.5 rounded-xl bg-accent px-5 py-2.5 text-white font-medium hover:bg-accent-hover transition-colors"
        >
          <SlackMark />
          Sign in with Slack
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

function SlackMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 122.8 122.8" aria-hidden>
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        fill="currentColor"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        fill="currentColor"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        fill="currentColor"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        fill="currentColor"
      />
    </svg>
  );
}
