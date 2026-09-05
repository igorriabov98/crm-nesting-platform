import { NextResponse } from "next/server";
import { processPendingMeetingRuleEvents } from "@/lib/meetings-v2/engine";
import { authorizeMeetingCron } from "@/lib/meetings-v2/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function evaluate(request: Request) {
  if (!(await authorizeMeetingCron(request)))
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
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
