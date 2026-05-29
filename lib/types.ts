export type Language =
  | 'en-in'
  | 'en-us'
  | 'en-gb'
  | 'en-au'
  | 'hi-in'
  | 'te-in';

export type VoiceGender = 'male' | 'female' | 'neutral';

export type Persona = 'Professional' | 'Friendly' | 'Direct' | 'Consultative';

export interface CompanyContext {
  company_name: string;
  summary: string;
  industry: string;
  services?: string[];
}

export interface PrepareContextRequest {
  url: string;
  language: Language;
  voice: VoiceGender;
  persona: Persona;
}

export interface PrepareContextResponse {
  joinUrl: string;
  callId: string;
  companyContext: CompanyContext;
  callSessionId: string | null;
}
