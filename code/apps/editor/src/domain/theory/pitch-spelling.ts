import type { KeySignature } from './notation-types.ts';

namespace PitchSpelling {
  function keySpellings(key: KeySignature) {
    const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const naturals = [0, 2, 4, 5, 7, 9, 11];
    const order = key.fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
    const keyAlter = naturals.map((_, index) => order.slice(0, Math.abs(key.fifths)).includes(index) ? Math.sign(key.fifths) : 0);
    return { steps, naturals, keyAlter };
  }
  export function forPreview(midi: number, key: KeySignature, direction?: 'up' | 'down') {
    const { steps, naturals, keyAlter } = keySpellings(key);
    const pc = ((midi % 12) + 12) % 12;
    if (direction) {
      const adjacent = direction === 'up' ? (pc + 11) % 12 : (pc + 1) % 12;
      const index = naturals.findIndex((natural, i) => (natural + keyAlter[i] + 12) % 12 === adjacent);
      if (index >= 0) {
        const alter = keyAlter[index] + (direction === 'up' ? 1 : -1);
        const octave = Math.floor((midi - naturals[index] - alter) / 12) - 1;
        if ((midi - naturals[index] - alter) % 12 === 0) return { step: steps[index], alter, octave,
          cost: Math.abs(alter - keyAlter[index]) * 10 + Math.abs(alter) };
      }
    }
    const keyIndex = naturals.findIndex((natural, i) => (natural + keyAlter[i] + 12) % 12 === pc);
    if (keyIndex >= 0) {
      const octave = Math.floor((midi - naturals[keyIndex] - keyAlter[keyIndex]) / 12) - 1;
      return { step: steps[keyIndex], alter: keyAlter[keyIndex], octave,
        cost: Math.abs(keyAlter[keyIndex] - keyAlter[keyIndex]) * 10 + Math.abs(keyAlter[keyIndex]) };
    }
    // Chromatic pitches default to a sharp-side spelling from the key's scale.
    const lower = (pc + 11) % 12;
    const lowerIndex = naturals.findIndex((natural, i) => (natural + keyAlter[i] + 12) % 12 === lower);
    const candidates = naturals.flatMap((natural, index) => [-2, -1, 0, 1, 2].flatMap((alter) => {
      const octave = (midi - natural - alter) / 12 - 1;
      return Number.isInteger(octave) ? [{
        step: steps[index], alter, octave,
        cost: Math.abs(alter - keyAlter[index]) * 10 + Math.abs(alter) +
          (alter !== 0 && Math.sign(alter) !== (key.fifths < 0 ? -1 : 1) ? 1 : 0),
      }] : [];
    }));
    if (lowerIndex >= 0) {
      const alter = keyAlter[lowerIndex] + 1;
      const octave = Math.floor((midi - naturals[lowerIndex] - alter) / 12) - 1;
      return { step: steps[lowerIndex], alter, octave, cost: Math.abs(alter-keyAlter[lowerIndex])*10+Math.abs(alter) };
    }
    return candidates.sort((a, b) => a.cost - b.cost)[0];
  }

  export function directionForMove(midi: number, key: KeySignature, direction: 'up' | 'down') {
    const { steps, naturals, keyAlter } = keySpellings(key);
    const pc = ((midi % 12) + 12) % 12;
    const keyIndex = naturals.findIndex((natural, index) => (natural + keyAlter[index] + 12) % 12 === pc);
    if (keyIndex >= 0) {
      // Natural key tones always normalize to the signature. Altered key tones
      // normalize only when the directional spelling agrees with that signature.
      if (keyAlter[keyIndex] === 0) return undefined;
      const directional = forPreview(midi, key, direction);
      if (directional.step === steps[keyIndex] && directional.alter === keyAlter[keyIndex]) return undefined;
    }
    return direction;
  }
}
export default PitchSpelling;
