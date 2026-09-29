import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { readPostmortem, submitResponse, PmRatings } from "@/lib/postmortem-store";
import { readProjects, updateProjects } from "@/lib/projects-store";
import { slackDm } from "@/lib/slack-notify";
import { scheduleTeamStatusUpdate } from "@/lib/team-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Post-mortem responses for one project — the Google-Form questionnaire,
 * platform-native. GET returns the doc (any signed-in member; producers
 * read the same data they always evaluated on). POST upserts the caller's
 * own response; with wrap=true it ALSO finalizes the project as done —
 * that's Puput's sequencing: flagship "Mark done" routes to the wrap form,
 * and only the submitted form flips doneAt.
 */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;
  const doc = await readPostmortem(id);
  return NextResponse.json({
    postmortem: doc,
    myResponse: doc.responses.find((r) => r.userKey === gate.person.key) ?? null,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;

  let body: {
    involvement?: string;
    wentWell?: string;
    challenges?: string;
    improvements?: string;
    ratings?: Partial<PmRatings>;
    wrap?: boolean;
    /** With wrap: Slack ids of involved members to invite (from the UI). */
    invite?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // The form's required questions stay required — exactly like the original.
  for (const [k, label] of [
    ["involvement", "involvement/responsibility"],
    ["wentWell", "what went well"],
    ["challenges", "challenges"],
    ["improvements", "improvements"],
  ] as const) {
    if (!body[k]?.trim()) {
      return NextResponse.json({ error: `"${label}" is required` }, { status: 400 });
    }
  }
  const r = body.ratings ?? {};
  const doc = await submitResponse(id, {
    userKey: gate.person.key,
    name: gate.person.name,
    involvement: body.involvement!,
    wentWell: body.wentWell!,
    challenges: body.challenges!,
    improvements: body.improvements!,
    ratings: {
      perception: r.perception ?? 3,
      communication: r.communication ?? 3,
      speed: r.speed ?? 3,
      creativity: r.creativity ?? 3,
      outcome: r.outcome ?? 3,
    },
    isWrap: body.wrap === true,
  });

  // Wrap submission: NOW the project becomes done, stamped with the wrapper.
  if (body.wrap === true) {
    await updateProjects((list) =>
      list.map((p) =>
        p.id === id
          ? {
              ...p,
              doneAt: p.doneAt ?? new Date().toISOString(),
              wrappedBy: { name: gate.person.name, slackId: gate.person.key, at: new Date().toISOString() },
            }
          : p
      )
    );
    scheduleTeamStatusUpdate();

    // Invite the rest of the involved team (fire-and-forget DMs).
    const invite = (body.invite ?? []).filter(
      (s) => typeof s === "string" && /^[UW][A-Z0-9]{6,}$/.test(s) && s !== gate.person.key
    );
    if (invite.length > 0) {
      const project = (await readProjects()).find((p) => p.id === id);
      const base = (process.env.AUTH_URL ?? "").replace(/\/api\/auth\/?$/, "").replace(/\/$/, "");
      const url = `${base}/projects/${encodeURIComponent(id)}/wrap`;
      for (const slackId of invite) {
        void slackDm(
          slackId,
          `:bulb: *${project?.name ?? "A project"}* just wrapped. ${gate.person.name} filled the post-mortem — please add your reflection too (3 questions + ratings, ~3 minutes):\n${url}`
        ).catch(() => {});
      }
    }
  }

  return NextResponse.json({ postmortem: doc });
}
