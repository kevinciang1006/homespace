// Shared guard for /api/cc/* — reuses CRON_SECRET (already provisioned in Vercel + .env.local).
export function ccAuthorized(request: Request): boolean {
  const url = new URL(request.url)
  const provided = url.searchParams.get('secret') ?? request.headers.get('x-cc-secret')
  return !!provided && provided === process.env.CRON_SECRET
}
