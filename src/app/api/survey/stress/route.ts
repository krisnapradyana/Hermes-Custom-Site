import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { score, validateAnswers, bandOf, INSTRUMENT_VERSION } from "@/lib/stress-instrument";
import {
  submitStress,
  myResponses,
  meterStates,
  aggregate,
  currentWindow,
  MIN_AGGREGATE_N,
} from "@/lib/stress-store";
import { readMembers, canEditDirectory } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sprint Stress Check API. Privacy is structural, per the spec: the caller's
 * identity comes from the session only — no endpoint accepts a userId — so
 * nobody can request another person's results.
 *
 * Leadership gate for the team meter: directory leadership types +
 * ADMIN_SLACK_IDS. Deliberately does NOT use the directory's OPEN_ALPHA
 * bypass — stress data is too sensitive for a temporary convenience flag.
 */

async function isLeadership(slackId: string): Promise<boolean> {
  const admins = (process.env.ADMIN_SLACK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.includes(slackId)) return true;
  const member = (await readMembers()).find((m) => m.slackId === slackId);
  return canEditDirectory(member?.type);
}

export async function GET() {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { key, name } = gate.person;

  const win = currentWindow();
  const mine = await myResponses(key);
  const current = mine.find((r) => r.windowLabel === win.label) ?? null;
  const lead = await isLeadership(key);

  // Meter roster = everyone in the member directory with a linked Slack id.
  const meter = lead
    ? await meterStates(
        (await readMembers())
          .filter((m) => m.slackId)
          .map((m) => ({ userKey: m.slackId!, name: m.name }))
      )
    : null;

  return NextResponse.json({
    window: { label: win.label, closesAt: new Date(win.closesAt).toISOString() },
    instrumentVersion: INSTRUMENT_VERSION,
    me: {
      name,
      taken: !!current,
      // Own scores + full trend — owner only, by construction.
      current: current
        ? { scores: current.scores, band: current.scores.stress_score !== null ? bandOf(current.scores.stress_score) : null, submittedAt: current.submittedAt }
        : null,
      trend: mine
        .filter((r) => r.scores.stress_score !== null)
        .map((r) => ({ window: r.windowLabel, score: r.scores.stress_score as number }))
        .reverse(),
    },
    isLeadership: lead,
    meter,
    aggregate: await aggregate(),
    minAggregateN: MIN_AGGREGATE_N,
  });
}

export async function POST(req: NextRequest) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;

  let body: { instrument_version?: string; answers?: unknown; free_text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.instrument_version !== INSTRUMENT_VERSION) {
    return NextResponse.json(
      { error: `instrument_version must be ${INSTRUMENT_VERSION}` },
      { status: 422 }
    );
  }
  const invalid = validateAnswers(body.answers, body.free_text);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 });

  const win = currentWindow();
  const answers = body.answers as Record<string, number>;
  const scores = score(answers);
  const freeText =
    typeof body.free_text === "string" && body.free_text.trim() ? body.free_text.trim() : null;

  await submitStress({
    userKey: gate.person.key,
    name: gate.person.name,
    windowLabel: win.label,
    answers,
    freeText,
    scores,
    instrumentVersion: INSTRUMENT_VERSION,
  });

  return NextResponse.json({
    scores,
    band: scores.stress_score !== null ? bandOf(scores.stress_score) : null,
    window: win.label,
  });
}
