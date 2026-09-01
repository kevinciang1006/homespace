import { describe, it, expect } from 'vitest'
import { TOOLS, findTool } from './tools'

describe('TOOLS registry', () => {
  it('has unique tool names', () => {
    const names = TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every confirmation-required tool declares confirm_text as required input', () => {
    for (const tool of TOOLS.filter(t => t.requiresConfirmation)) {
      expect(tool.input_schema.properties).toHaveProperty('confirm_text')
      expect(tool.input_schema.required ?? []).toContain('confirm_text')
    }
  })

  it('no read-only or simple-add tool requires confirm_text (immediate tools stay immediate)', () => {
    for (const tool of TOOLS.filter(t => !t.requiresConfirmation)) {
      expect(tool.input_schema.required ?? []).not.toContain('confirm_text')
    }
  })

  it('findTool resolves a known tool and returns undefined for an unknown one', () => {
    expect(findTool('add_shopping_item_general')?.name).toBe('add_shopping_item_general')
    expect(findTool('not_a_real_tool')).toBeUndefined()
  })

  it('every tool has a non-empty description (Claude needs it to pick the right tool)', () => {
    for (const tool of TOOLS) expect(tool.description.length).toBeGreaterThan(10)
  })
})
