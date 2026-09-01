import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // Mirrors tsconfig.json's "@/*": ["./*"] — without this, any lib file
  // that reaches across directories via a "@/..." import (rather than a
  // relative one) fails to resolve under vitest, even though it compiles
  // and runs fine in Next.js itself. Several lib files have hit this the
  // hard way before this got fixed here; new ones shouldn't have to.
  resolve: { alias: { '@': path.resolve(__dirname) } },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    // lib/supabase.ts creates its client eagerly at import time — tests
    // that only check shape/pure logic (never actually call supabase) still
    // transitively import it and need SOME value here or createClient()
    // throws on import. Not real credentials; nothing in this test suite
    // performs a real network call.
    env: { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
})
