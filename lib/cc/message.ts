// "⏳ Claude Code is waiting on you in <repo>\n   <message>"
export function composeHangNudge(cwd: string | null, message: string | null): string {
  const trimmedCwd = cwd?.trim().replace(/\/+$/, '') ?? ''
  const where = trimmedCwd ? (trimmedCwd.split('/').pop() || 'a session') : 'a session'
  const msg = message?.trim() || "It's been idle a while."
  return `⏳ Claude Code is waiting on you in ${where}\n   ${msg}`
}
