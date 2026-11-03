import type { KeySignature } from './notation-types.ts';
namespace KeyTheory {
  export function pitchClasses(keySignature: KeySignature): Set<number> {
    const naturalPitchClasses = [0, 2, 4, 5, 7, 9, 11];
    const fifths = keySignature.fifths;
    const order = fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
    const altered = new Set(order.slice(0, Math.abs(fifths)));
    return new Set(naturalPitchClasses.map((pitch, step) =>
      (pitch + (altered.has(step) ? Math.sign(fifths) : 0) + 12) % 12,
    ));
  }

  export function label(key: KeySignature): string {
    const count = Math.abs(key.fifths);
    return count === 0 ? 'None' : `${count} ${key.fifths > 0 ? 'sharp' : 'flat'}${count === 1 ? '' : 's'}`;
  }

}
export default KeyTheory;
