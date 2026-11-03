import type { KeySignature } from './notation-types.ts';

namespace PitchSpelling {
  /** Preview-only spelling. User-controlled enharmonic spelling is still a separate domain task. */
  export function forPreview(midi: number, key: KeySignature) {
    const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const naturals = [0, 2, 4, 5, 7, 9, 11];
    const order = key.fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
    const keyAlter = naturals.map((_, index) => order.slice(0, Math.abs(key.fifths)).includes(index) ? Math.sign(key.fifths) : 0);
    const candidates = naturals.flatMap((natural, index) => [-2, -1, 0, 1, 2].flatMap((alter) => {
      const octave = (midi - natural - alter) / 12 - 1;
      return Number.isInteger(octave) ? [{
        step: steps[index], alter, octave,
        cost: Math.abs(alter - keyAlter[index]) * 10 + Math.abs(alter) +
          (alter !== 0 && Math.sign(alter) !== (key.fifths < 0 ? -1 : 1) ? 1 : 0),
      }] : [];
    }));
    return candidates.sort((a, b) => a.cost - b.cost)[0];
  }
}
export default PitchSpelling;
