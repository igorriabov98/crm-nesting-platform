export async function GET() {
  return Response.json({ sha: process.env.DEPLOY_SHA ?? null })
}
