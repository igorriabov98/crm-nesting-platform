export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return Response.json(
    { sha: process.env.DEPLOY_SHA ?? null },
    {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate, max-age=0',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    },
  )
}
