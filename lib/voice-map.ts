import type { Language, VoiceGender } from './types';

// Voice IDs verified against the Ultravox /api/voices catalog.
// No native Telugu voice exists, so te-in falls back to Hindi voices
// while the prompt directive instructs the model to speak Telugu.
export function pickVoice(language: Language, gender: VoiceGender): string {
  switch (language) {
    case 'en-us':
    case 'en-au':
      if (gender === 'male') return 'David';
      if (gender === 'female') return 'Gabrielle';
      return 'Gabrielle';
    case 'en-gb':
      if (gender === 'male') return 'Clive';
      if (gender === 'female') return 'Olivia';
      return 'Olivia';
    case 'en-in':
      if (gender === 'male') return 'Amrut-English-Indian';
      if (gender === 'female') return 'Saavi-English-Indian';
      return 'Anika-English-Indian';
    case 'hi-in':
      if (gender === 'male') return 'Krishna-Hindi-Urdu';
      if (gender === 'female') return 'Anjali-Hindi-Urdu';
      return 'Muskaan-Hindi-Urdu';
    case 'te-in':
      if (gender === 'male') return 'Krishna-Hindi-Urdu';
      if (gender === 'female') return 'Muskaan-Hindi-Urdu';
      return 'Anjali-Hindi-Urdu';
    case 'ar':
      if (gender === 'male') return 'f88eb366-df8e-4115-9f7c-ebf3abac7d1b';
      if (gender === 'female') return 'd766b9e3-69df-4727-b62f-cd0b6772c2ad';
      return 'd766b9e3-69df-4727-b62f-cd0b6772c2ad';
  }
}
