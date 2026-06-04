import { describe, it, expect } from 'vitest';
import { cleanRepetitiveText } from './use-ultravox';

describe('cleanRepetitiveText', () => {
  it('passes normal text unchanged', () => {
    expect(cleanRepetitiveText('this is a clean transcript')).toBe('this is a clean transcript');
  });

  it('keeps up to 3 repetitions but filters 4 or more', () => {
    expect(cleanRepetitiveText('hello hello hello')).toBe('hello hello hello');
    expect(cleanRepetitiveText('hello hello hello hello')).toBe('hello hello hello');
    expect(cleanRepetitiveText('hello hello hello hello hello hello')).toBe('hello hello hello');
  });

  it('cleans Arabic silence loops (نعم)', () => {
    expect(cleanRepetitiveText('نعم، نعم، نعم، نعم، نعم')).toBe('نعم، نعم، نعم');
    expect(cleanRepetitiveText('أفهم، هل تواجهون نعم نعم نعم نعم نعم نعم')).toBe('أفهم، هل تواجهون نعم نعم نعم');
  });

  it('respects punctuation spacing', () => {
    expect(cleanRepetitiveText('أفهم، يمكن أن يكون هناك فرق؟ نعم، نعم، نعم، نعم'))
      .toBe('أفهم، يمكن أن يكون هناك فرق؟ نعم، نعم، نعم');
  });
});
