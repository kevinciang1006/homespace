// Deliberately a simple keyword check rather than another model call — a
// confirm turn is either a clear yes/no or it isn't, in which case the
// caller falls through to a normal (fresh) turn rather than guessing.
const YES_WORDS = ['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'confirm', 'do it', 'go ahead', 'iya', 'ya', 'yap', 'betul', 'benar', 'oke', 'sip', 'lanjut', 'boleh', 'gas']
const NO_WORDS = ['no', 'nope', 'nah', 'cancel', 'stop', "don't", 'never mind', 'tidak', 'gak', 'ga', 'nggak', 'enggak', 'batal', 'jangan']

export function classifyYesNo(text: string): 'yes' | 'no' | 'unclear' {
  const t = ` ${text.trim().toLowerCase()} `
  if (YES_WORDS.some(w => t.includes(` ${w} `))) return 'yes'
  if (NO_WORDS.some(w => t.includes(` ${w} `))) return 'no'
  return 'unclear'
}
