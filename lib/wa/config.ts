// Fixed household recipients — not user-editable (see design spec §Recipients).
export const WA_NUMBERS = {
  wife: '+6283194111119',
  kevin: '+6282242382604',
} as const

export const HOMESPACE_URL = 'https://homespace-chi.vercel.app'

export function resolveRecipients(includeKevin: boolean): string[] {
  return includeKevin ? [WA_NUMBERS.wife, WA_NUMBERS.kevin] : [WA_NUMBERS.wife]
}

export function shoppingPageUrl(): string {
  return `${HOMESPACE_URL}/meals/shopping`
}

export function dayPageUrl(date: string): string {
  return `${HOMESPACE_URL}/meals/day/${date}`
}
