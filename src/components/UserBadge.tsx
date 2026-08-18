"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

/** Shows the signed-in Slack user in the sidebar footer. Renders nothing when auth is off. */
export function UserBadge() {
  const { data } = useSession();
  if (!data?.user) return null;

  return (
    <div className="flex items-center gap-2.5">
      {data.user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.user.image} alt="" className="w-7 h-7 rounded-full shrink-0" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-xs font-semibold shrink-0">
          {(data.user.name ?? "?").charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{data.user.name}</p>
        <p className="text-[11px] text-ink-faint truncate">
          Slack · {data.user.slackId ?? "unknown id"}
        </p>
      </div>
      <button
        onClick={() => signOut()}
        className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-ink"
        title="Sign out"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
