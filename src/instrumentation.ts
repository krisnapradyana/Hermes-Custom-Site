/**
 * Next.js server-start hook. Runs once when the Node server boots
 * (not during build), which makes it the right place to validate
 * configuration loudly before any request is served.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
    // Regenerate the shared project tracker on boot so it reflects any
    // changes made while the app was down. Non-fatal by design.
    const { updateTracker } = await import("./lib/tracker");
    updateTracker();
    // Team status digest for the agent: refresh on boot and every 5 minutes
    // so clock-ins/outs surface without any task mutation. Non-fatal.
    const { updateTeamStatus } = await import("./lib/team-status");
    updateTeamStatus();
    setInterval(() => updateTeamStatus(), 5 * 60_000).unref?.();
  }
}
