const TTS_URL = 'https://api.sarvam.ai/text-to-speech';
const STT_URL = 'https://api.sarvam.ai/speech-to-text';
const CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';

export interface SarvamChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function stripThinkTags(s: string): string {
  // Sarvam-M wraps reasoning in <think>...</think>; strip those and any
  // dangling open tag without close so the user only sees the final answer.
  return s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/g, '')
    .trim();
}

// Map of English abbreviations → their letter-spelled-out Telugu phonetic form.
// The TTS engine mispronounces bare English abbreviations inside Telugu text;
// replacing them with the Telugu phonetic letters makes speech natural.
const TELUGU_ABBR_MAP: [RegExp, string][] = [
  // Compound first so "AI/ML" is caught before the individual entries.
  [/\bAI\s*\/\s*ML\b/gi, 'ఏ ఐ ఎం ఎల్'],
  [/\bML\s*\/\s*AI\b/gi, 'ఎం ఎల్ ఏ ఐ'],
  // Individual abbreviations (word-boundary aware).
  [/\bAI\b/g,  'ఏ ఐ'],
  [/\bML\b/g,  'ఎం ఎల్'],
  [/\bIT\b/g,  'ఐ టీ'],
  [/\bAPI\b/g, 'ఏ పీ ఐ'],
  [/\bCEO\b/g, 'సీ ఈ ఓ'],
  [/\bCTO\b/g, 'సీ టీ ఓ'],
  [/\bCFO\b/g, 'సీ ఎఫ్ ఓ'],
  [/\bHR\b/g,  'ఎచ్ ఆర్'],
  [/\bUI\b/g,  'యూ ఐ'],
  [/\bUX\b/g,  'యూ ఎక్స్'],
  [/\bSaaS\b/gi, 'సాస్'],
  [/\bB2B\b/gi,  'బీ టు బీ'],
  [/\bB2C\b/gi,  'బీ టు సీ'],
  [/\bROI\b/g,   'ఆర్ ఓ ఐ'],
  [/\bKPI\b/g,   'కే పీ ఐ'],
  [/\bERP\b/g,   'ఈ ఆర్ పీ'],
  [/\bCRM\b/g,   'సీ ఆర్ ఎం'],
];

/**
 * Normalise text before sending to the Sarvam bulbul:v2 TTS engine for
 * Telugu. Replaces common English abbreviations with their phonetic Telugu
 * equivalents so the engine pronounces them correctly instead of treating
 * each letter as a Telugu akshara.
 */
export function normalizeForTeluguTts(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TELUGU_ABBR_MAP) {
    out = out.replace(pattern, replacement);
  }
  // Collapse runs of slashes/spaces left by "A / B" style tokens.
  out = out.replace(/\s*\/s*/g, ' ');
  return out;
}

// Map of Telugu phonetic mishearings in ASR → correct English terms/abbreviations.
// The STT model often phonetically transcribes English terms in Telugu letters
// (e.g. hearing "n8n" as "ఎన్ఏ 10"). Mapping these back helps the LLM understand.
const TELUGU_ASR_CORRECTIONS: [RegExp, string][] = [
  // n8n variations
  [/ఎన్\s*ఏ\s*10/gi, 'n8n'],
  [/ఎన్\s*ఎయిట్\s*ఎన్/gi, 'n8n'],
  [/ఎన్\s*ఎనిమిది\s*ఎన్/gi, 'n8n'],
  [/ఎన్\s*8\s*ఎన్/gi, 'n8n'],
  [/ఎన్\s*ఎ\s*10/gi, 'n8n'],
  [/ఎన్\s*ఏ\s*టెన్/gi, 'n8n'],
  // Common abbreviations
  [/ఏ\s*ఐ/gi, 'AI'],
  [/ఎం\s*ఎల్/gi, 'ML'],
  [/ఐ\s*టీ/gi, 'IT'],
  [/ఏ\s*పీ\s*ఐ/gi, 'API'],
  [/సీ\s*ఈ\s*ఓ/gi, 'CEO'],
  [/సీ\s*టీ\s*ఓ/gi, 'CTO'],
  [/సీ\s*ఆర్\s*ఎం/gi, 'CRM'],
];

/**
 * Clean up Telugu ASR transcripts before sending them to the LLM.
 * Replaces phonetic Telugu representation of common tools/terms with their
 * correct English equivalents.
 */
export function normalizeTeluguTranscript(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TELUGU_ASR_CORRECTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export async function sarvamChat(
  apiKey: string,
  messages: SarvamChatMessage[],
  opts: { maxTokens?: number; temperature?: number; reasoningEffort?: 'low' | 'medium' | 'high' | null } = {}
): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sarvam-30b',
      messages,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.7,
      reasoning_effort: opts.reasoningEffort !== undefined ? opts.reasoningEffort : null,
    }),
  });
  if (!res.ok) {
    throw new Error(`Sarvam chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content ?? '';
  return stripThinkTags(String(raw));
}

export interface SarvamTtsOpts {
  text: string;
  language: string; // e.g. 'te-IN'
  speaker?: string; // e.g. 'anushka', 'abhilash'
}

export async function sarvamTts(
  apiKey: string,
  opts: SarvamTtsOpts
): Promise<string /* base64 wav */> {
  let text = (opts.text ?? '').trim();
  if (!text) {
    throw new Error('Sarvam TTS: text is empty — upstream chat returned no usable reply');
  }
  // Normalize abbreviations for Telugu TTS so they are pronounced correctly.
  if (opts.language === 'te-IN') {
    text = normalizeForTeluguTts(text);
  }
  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'api-subscription-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      target_language_code: opts.language,
      speaker: opts.speaker ?? 'anushka',
      model: 'bulbul:v2',
    }),
  });
  if (!res.ok) {
    throw new Error(`Sarvam TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  const audio = j?.audios?.[0];
  if (!audio) throw new Error('Sarvam TTS: no audio in response');
  return String(audio);
}

export interface SarvamSttResult {
  transcript: string;
  language?: string;
}

export async function sarvamStt(
  apiKey: string,
  audioBlob: Blob,
  filename: string,
  language = 'te-IN'
): Promise<SarvamSttResult> {
  const form = new FormData();
  form.append('file', audioBlob, filename);
  // saarika = in-language ASR (Telugu audio → Telugu text).
  // saaras would translate to English, breaking the Telugu conversation flow.
  form.append('model', 'saarika:v2.5');
  form.append('language_code', language);

  const res = await fetch(STT_URL, {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Sarvam STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const j = await res.json();
  return {
    transcript: String(j?.transcript ?? ''),
    language: j?.language_code ? String(j.language_code) : undefined,
  };
}
