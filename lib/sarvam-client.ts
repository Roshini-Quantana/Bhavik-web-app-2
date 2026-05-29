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

export async function sarvamChat(
  apiKey: string,
  messages: SarvamChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sarvam-m',
      messages,
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.7,
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
  const text = (opts.text ?? '').trim();
  if (!text) {
    throw new Error('Sarvam TTS: text is empty — upstream chat returned no usable reply');
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
