import type { Language, VoiceGender } from './types';

export function pickVoice(language: Language, gender: VoiceGender): string {
  if (language === 'hi-in') {
    if (gender === 'male') return 'Anjali-Hindi-Urdu';
    if (gender === 'female') return 'Riya-Rao-Hindi-Urdu';
    return 'Cassidy';
  }
  if (language === 'te-in') {
    if (gender === 'male') return 'Krishna-Telugu';
    if (gender === 'female') return 'Sita-Telugu';
    return 'Cassidy';
  }
  if (gender === 'male') return 'Mark';
  if (gender === 'female') return 'Jessica';
  return 'Cassidy';
}
