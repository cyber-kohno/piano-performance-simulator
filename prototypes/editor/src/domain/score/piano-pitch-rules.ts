import type { KeySignature } from '../theory/notation-types.ts';
import KeyTheory from '../theory/key-signature.ts';
namespace PianoPitchRules {
  export const min=21;
  export const max=108;
  /** Current editor chord-span rule; not a restriction of music theory. */
  export function allowsChord(midis: readonly number[]): boolean {
    return Math.max(...midis)-Math.min(...midis)<16;
  }
  export function next(
    pitch: number,direction: -1|1,keySignature?: KeySignature,
    occupied: ReadonlySet<number>=new Set(),
  ): number|undefined {
    const allowed=keySignature? KeyTheory.pitchClasses(keySignature):undefined;
    for(let midi=pitch+direction;midi>=min&&midi<=max;midi+=direction) {
      if(!occupied.has(midi)&&(!allowed||allowed.has(midi%12))) return midi;
    }
    return undefined;
  }


}
export default PianoPitchRules;
