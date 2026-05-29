import { getSupabase, AUDIO_BUCKET } from './supabase';

export type AudioFormat = 'wav' | 'webm' | 'mp3';

const CONTENT_TYPE: Record<AudioFormat, string> = {
  wav: 'audio/wav',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
};

// Path layout: {sessionId}/{0000-idx}-{speaker}.{ext}
// Pads the index so an alphabetical listing matches the turn order.
function audioPath(
  callSessionId: string,
  turnIndex: number,
  speaker: 'user' | 'agent',
  ext: AudioFormat
): string {
  return `${callSessionId}/${String(turnIndex).padStart(4, '0')}-${speaker}.${ext}`;
}

export async function uploadAudio(
  callSessionId: string | null,
  turnIndex: number,
  speaker: 'user' | 'agent',
  bytes: Uint8Array | Blob,
  ext: AudioFormat = 'wav'
): Promise<string | null> {
  if (!callSessionId) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const path = audioPath(callSessionId, turnIndex, speaker, ext);
  const contentType = CONTENT_TYPE[ext];
  // Cast through unknown — TS narrows Uint8Array<SharedArrayBuffer>, which isn't
  // a BlobPart, but Blob accepts both at runtime.
  const body =
    bytes instanceof Blob
      ? bytes
      : new Blob([bytes as unknown as ArrayBuffer], { type: contentType });
  const { error } = await sb.storage
    .from(AUDIO_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (error) {
    console.error('[supabase] uploadAudio error:', error.message);
    return null;
  }
  return path;
}
