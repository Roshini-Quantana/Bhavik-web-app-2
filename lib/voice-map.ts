import type { Language, VoiceGender } from './types';

export function pickVoice(language: Language, gender: VoiceGender): string {
  if (language === 'hi-in') {
    if (gender === 'male') return 'Anjali-Hindi-Urdu';
    if (gender === 'female') return 'Riya-Rao-Hindi-Urdu';
    return 'Cassidy';
  }
  if (gender === 'male') return 'Mark';
  if (gender === 'female') return 'Jessica';
  return 'Cassidy';
}
