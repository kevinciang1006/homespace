export type RecipeSource = 'youtube' | 'instagram' | 'tiktok' | 'web'
export type RecipeLink = { url: string; title?: string; source: RecipeSource }

export function detectSource(url: string): RecipeSource {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'web' }
  if (host.includes('youtube.') || host === 'youtu.be' || host.endsWith('.youtu.be')) return 'youtube'
  if (host.includes('instagram.')) return 'instagram'
  if (host.includes('tiktok.')) return 'tiktok'
  return 'web'
}
