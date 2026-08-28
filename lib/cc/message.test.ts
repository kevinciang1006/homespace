import { describe, it, expect } from 'vitest'
import { composeHangNudge } from './message'

describe('composeHangNudge', () => {
  it('uses the basename of cwd and the message, on two lines', () => {
    expect(composeHangNudge('/Users/k/Documents/Projects/homespace', 'Need your input on the migration'))
      .toBe('⏳ Claude Code is waiting on you in homespace\n   Need your input on the migration')
  })

  it('strips a trailing slash from cwd', () => {
    expect(composeHangNudge('/x/y/concourse/', 'q'))
      .toBe('⏳ Claude Code is waiting on you in concourse\n   q')
  })

  it('falls back to "a session" when cwd is null or blank', () => {
    expect(composeHangNudge(null, 'q')).toContain('waiting on you in a session')
    expect(composeHangNudge('   ', 'q')).toContain('waiting on you in a session')
  })

  it('falls back to a default when message is null or blank', () => {
    expect(composeHangNudge('/x/homespace', null))
      .toBe("⏳ Claude Code is waiting on you in homespace\n   It's been idle a while.")
    expect(composeHangNudge('/x/homespace', '   ')).toContain("It's been idle a while.")
  })

  it('trims the message', () => {
    expect(composeHangNudge('/x/homespace', '  hi  '))
      .toBe('⏳ Claude Code is waiting on you in homespace\n   hi')
  })
})
