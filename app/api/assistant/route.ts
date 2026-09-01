import { jakartaToday } from '@/lib/wa/schedule'
import { TOOLS, findTool } from '@/lib/assistant/tools'
import { classifyYesNo } from '@/lib/assistant/confirm'
import type { ChatMessage, PendingAction, ToolContext } from '@/lib/assistant/types'

// claude-haiku-4-5 to start — cheap and fast enough for tool routing. If
// Indonesian intent parsing turns out weak in practice (mixed-language
// utterances, slang, ambiguous quantities), swap MODEL to
// 'claude-sonnet-4-6' — nothing else in this file needs to change, the
// tool-use loop and confirm flow are model-agnostic.
const MODEL = 'claude-haiku-4-5'
const MAX_TOOL_ROUNDS = 3

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

const SYSTEM_PROMPT = `You are the voice assistant inside Homespace, a family home-management app. The user is speaking, not typing — replies are read aloud, so keep them SHORT (one sentence, two at most).

Today's date (Asia/Jakarta) is ${jakartaToday()}. Resolve relative dates ("besok", "tomorrow", "minggu ini") to ISO YYYY-MM-DD yourself before calling a tool.

LANGUAGE: the user speaks Indonesian or English, sometimes mixed. Always reply in the SAME language as her most recent message. Match her phrasing style — casual, not formal.

SCOPE: you can only help with shopping lists, expenses, stock/pantry inventory, the meal plan, and the backlog (household to-do list). If she asks for anything else (weather, general chat, unrelated apps, anything with no matching tool), say plainly that it's not something you can do here — never invent an action or pretend to do something you have no tool for.

SHOPPING LISTS: there are TWO separate lists. Default to the GENERAL (ad-hoc) list unless she explicitly says "meal", "weekly", or "minggu ini" — then use the meal-plan list tools instead. If it's unclear which she means, ask.

CONFIRMATION: tools that delete something, spend money, or change a stock count require confirmation. When you call one of those, you MUST include a short confirm_text argument — a natural one-line question in her language (e.g. "Tambah 2 liter susu ke belanja?" or "Delete the eggs from stock?") — and do NOT claim the action is done yet; she needs to confirm on her next turn. Reads and simple adds (shopping items, backlog items, a new ingredient or dish) can happen immediately without asking.

AMBIGUITY: if a request is genuinely unclear (which list, which dish, which item, missing a number), ask ONE short follow-up question instead of guessing.

Never fabricate a result. If a tool fails or returns nothing, say so briefly.`

function parseSession(cookieHeader: string | null): { id: string; name: string; phone: string } | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/hs_session=([^;]+)/)
  if (!match) return null
  try { return JSON.parse(decodeURIComponent(match[1])) } catch { return null }
}

async function callClaude(messages: { role: string; content: unknown }[]) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 512, system: SYSTEM_PROMPT,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic API error ${res.status}: ${body}`)
  }
  return res.json() as Promise<{ content: AnthropicBlock[] }>
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const message = String(body.message ?? '').trim()
  const history: ChatMessage[] = Array.isArray(body.history) ? body.history : []
  const pendingAction: PendingAction | null = body.pendingAction ?? null
  if (!message) return Response.json({ error: 'message required' }, { status: 400 })

  const cookieHeader = request.headers.get('cookie')
  const ctx: ToolContext = { origin: new URL(request.url).origin, cookie: cookieHeader, session: parseSession(cookieHeader) }

  // ---- Confirm-flow short circuit: a pending action from last turn -------
  if (pendingAction) {
    const verdict = classifyYesNo(message)
    if (verdict === 'yes') {
      const tool = findTool(pendingAction.tool)
      const result = tool ? await tool.execute(pendingAction.input, ctx).catch(e => ({ ok: false, summary: e instanceof Error ? e.message : 'Something went wrong.' })) : { ok: false, summary: 'That action no longer exists.' }
      return Response.json({
        reply: result.summary, pendingAction: null,
        history: [...history, { role: 'user', content: message }, { role: 'assistant', content: result.summary }],
      })
    }
    if (verdict === 'no') {
      const reply = 'Okay, cancelled.'
      return Response.json({ reply, pendingAction: null, history: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }] })
    }
    // Unclear — drop the stale pending action and handle this as a fresh turn.
  }

  // ---- Normal turn: Claude picks (and we run) tools -----------------------
  const messages: { role: string; content: unknown }[] = [...history.map(h => ({ role: h.role, content: h.content })), { role: 'user', content: message }]
  let finalText = ''
  let newPending: PendingAction | null = null

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response
    try { response = await callClaude(messages) } catch (e) {
      console.error('[assistant] Claude call failed:', e)
      finalText = "Sorry, I couldn't reach the assistant just now — try again in a moment."
      break
    }
    const toolUses = response.content.filter((b): b is Extract<AnthropicBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    const text = response.content.filter((b): b is Extract<AnthropicBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join(' ').trim()

    if (toolUses.length === 0) { finalText = text || "Sorry, I didn't catch that — can you say it again?"; break }

    // Any tool in this turn needing confirmation stops the whole turn there —
    // nothing executes until she confirms on the next turn.
    const confirmUse = toolUses.find(b => findTool(b.name)?.requiresConfirmation)
    if (confirmUse) {
      const confirmText = typeof confirmUse.input.confirm_text === 'string' && confirmUse.input.confirm_text ? confirmUse.input.confirm_text : (text || 'Confirm?')
      newPending = { tool: confirmUse.name, input: confirmUse.input, confirmText }
      finalText = confirmText
      break
    }

    messages.push({ role: 'assistant', content: response.content })
    const toolResults = await Promise.all(toolUses.map(async block => {
      const tool = findTool(block.name)
      if (!tool) return { type: 'tool_result', tool_use_id: block.id, content: `Unknown tool: ${block.name}`, is_error: true }
      try {
        const result = await tool.execute(block.input, ctx)
        return { type: 'tool_result', tool_use_id: block.id, content: result.summary, is_error: !result.ok }
      } catch (e) {
        return { type: 'tool_result', tool_use_id: block.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true }
      }
    }))
    messages.push({ role: 'user', content: toolResults })
  }

  if (!finalText) finalText = "That took more steps than expected — can you try rephrasing?"

  return Response.json({
    reply: finalText,
    pendingAction: newPending,
    history: [...history, { role: 'user', content: message }, { role: 'assistant', content: finalText }],
  })
}
