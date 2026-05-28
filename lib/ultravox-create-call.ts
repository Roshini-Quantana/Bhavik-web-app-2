export interface CreateCallParams {
  systemPrompt: string;
  voice: string;
  languageHint: string;
}

export interface CreateCallResult {
  joinUrl: string;
  callId: string;
}

export async function createUltravoxCall(
  params: CreateCallParams,
  apiKey: string
): Promise<CreateCallResult> {
  const res = await fetch('https://api.ultravox.ai/api/calls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      systemPrompt: params.systemPrompt,
      model: 'fixie-ai/ultravox',
      voice: params.voice,
      languageHint: params.languageHint,
      firstSpeaker: 'FIRST_SPEAKER_AGENT',
      medium: { webRtc: {} },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ultravox create call failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  const json = await res.json();
  return { joinUrl: json.joinUrl, callId: json.callId };
}
