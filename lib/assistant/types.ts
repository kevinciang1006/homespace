// Shared shapes for the voice assistant's tool registry (lib/assistant/tools.ts)
// and its two API routes (transcribe, and the Claude tool-use loop itself).

export type ToolContext = {
  // Absolute origin of the incoming request (e.g. https://home.kevinciang.com)
  // — every tool that calls an EXISTING route does so via an internal fetch
  // to this origin, so it runs the exact same code path the UI button does
  // (composeDay, the reservation ledger, etc.) instead of a parallel
  // reimplementation. See AGENTS request: "Build tools that CALL existing
  // server actions/queries."
  origin: string
  // Forwarded from the incoming request so any downstream route that reads
  // hs_session for attribution (cook-log's logged_by, etc.) still sees the
  // real session, even though the call is server-to-server.
  cookie: string | null
  session: { id: string; name: string; phone: string } | null
}

export type ToolResult = {
  // Short, tool-specific summary handed back to Claude as the tool_result —
  // NOT shown to the user directly; Claude turns this into the final
  // natural-language reply (in whichever language she spoke).
  summary: string
  ok: boolean
}

export type ToolDefinition = {
  name: string
  description: string
  // Anthropic tool `input_schema` (JSON Schema subset).
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  // Deletes, spends money, changes stock counts, or is ambiguous — per the
  // build request, these must be confirmed on a SEPARATE turn, never acted
  // on silently. Reads and simple adds stay false (immediate).
  requiresConfirmation: boolean
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

// What the client resends each turn alongside the new utterance — see
// app/api/assistant/route.ts's confirm flow.
export type PendingAction = {
  tool: string
  input: Record<string, unknown>
  confirmText: string
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }
