"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

/** Shows the signed-in Slack user in the sidebar footer. Renders nothing when auth is off. */
export function UserBadge() {
  const { data } = useSession();

  // Role from the Member Directory (matched by Slack id) — null until the
  // person's record is linked, in which case the line simply doesn't render.
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.user) return;
    let dead = false;
    fetch("/api/directory/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!dead && d?.role) setRole(d.role as string);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [data?.user]);

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
        {role && <p className="text-[11px] text-accent truncate">{role}</p>}
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
