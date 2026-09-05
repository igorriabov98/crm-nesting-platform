import { NextResponse } from "next/server";
import { processPendingMeetingRuleEvents } from "@/lib/meetings-v2/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: Request) {
  const secret = (
    process.env.MEETING_RULES_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim();
  if (!secret)
    return {
      ok: false as const,
      status: 503,
      message: "Cron secret is not configured",
    };
  const allowed =
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret;
  return allowed
    ? { ok: true as const }
    : { ok: false as const, status: 401, message: "Unauthorized" };
}

async function evaluate(request: Request) {
  const auth = authorize(request);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, error: auth.message },
      { status: auth.status },
    );
  try {
    const result = await processPendingMeetingRuleEvents(100);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Meeting rules] Evaluation failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return evaluate(request);
}
export async function POST(request: Request) {
  return evaluate(request);
}
