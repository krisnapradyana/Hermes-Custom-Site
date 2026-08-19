/**
 * Slack DMs sent as the Hermes bot (SLACK_BOT_TOKEN — the same bot the agent
 * uses, so notifications arrive from a familiar face). Plain Web API calls,
 * no AI involved. Fire-and-forget: a failed DM never fails the request that
 * triggered it.
 *
 * Bot needs the `chat:write` + `im:write` scopes (the Hermes bot has them).
 */

const SLACK_API = "https://slack.com/api";

async function slackCall(
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null; // integration not configured — silently skip
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as Record<string, unknown> & { ok?: boolean; error?: string };
    if (!data.ok) {
      console.warn(`[slack-notify] ${method} failed: ${data.error}`);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[slack-notify] ${method} error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** DM one user by Slack id. */
export async function slackDm(slackUserId: string, text: string): Promise<void> {
  // Slack user ids start with U or W; anything else (e.g. "local") is not DM-able.
  if (!/^[UW][A-Z0-9]{5,}$/i.test(slackUserId)) return;
  const opened = await slackCall("conversations.open", { users: slackUserId });
  const channel = (opened?.channel as { id?: string } | undefined)?.id;
  if (!channel) return;
  await slackCall("chat.postMessage", { channel, text, unfurl_links: false });
}

/** The public URL of the assistant, for deep links in messages. */
function appOrigin(): string {
  try {
    return new URL(process.env.AUTH_URL ?? "").origin;
  } catch {
    return "";
  }
}

/** Fire-and-forget: notify someone they were assigned a task. */
export function notifyTaskAssigned(opts: {
  assigneeSlackId: string;
  assigneeName: string;
  taskTitle: string;
  phase?: string;
  dueDate?: string;
  projectId: string;
  projectName: string;
  byName: string;
}): void {
  const origin = appOrigin();
  const link = origin ? `\n${origin}/projects/${opts.projectId}/tasks` : "";
  const phase = opts.phase ? ` (${opts.phase})` : "";
  const due = opts.dueDate
    ? `\n⏰ Due ${new Date(`${opts.dueDate}T00:00:00`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })}`
    : "";
  const text =
    `📋 *${opts.byName}* assigned you a task in *${opts.projectName}*:\n` +
    `• ${opts.taskTitle}${phase}${due}${link}`;
  void slackDm(opts.assigneeSlackId, text);
}
