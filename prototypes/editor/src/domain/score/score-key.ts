
import MusicalTime from "../theory/musical-time.ts";
import ScoreVoice from "./score-voice.ts";
import type { OutlineBlock, KeySignature } from './types.ts';

import KeyTheory from '../theory/key-signature.ts';
export type MeasureKeyContext = { keySignature: KeySignature; pitchClasses: ReadonlySet<number> };
namespace ScoreKey {
  /** Derived cache, never saved: one outline pass; identical keys share scale data.
   * No cursor dependency, so moving the cursor cannot recolor existing measures.
   */
  export function buildMeasureCache(outline: readonly OutlineBlock[]): ReadonlyMap<string, MeasureKeyContext> {
    const result = new Map<string, MeasureKeyContext>();
    const contexts = new Map<number, MeasureKeyContext>();
    let key: KeySignature = { fifths: 0 };
    for (const block of outline) {
      if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
      if (block.type !== 'measure') continue;
      let context = contexts.get(key.fifths);
      if (!context) {
        context = { keySignature: { ...key }, pitchClasses: KeyTheory.pitchClasses(key) };
        contexts.set(key.fifths, context);
      }
      result.set(block.id, context);
    }
    return result;
  }
  export function contains(cache: ReadonlyMap<string, MeasureKeyContext>, measureId: string, midi: number): boolean {
    return cache.get(measureId)?.pitchClasses.has(((midi % 12) + 12) % 12) ?? false;
  }

  export function forBlock(outline: readonly OutlineBlock[], blockId: string): KeySignature {
    let key: KeySignature = { fifths: 0 };
    for (const block of outline) {
      if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
      if (block.id === blockId) break;
    }
    return key;
  }
  /** Zero-duration outline changes apply at the head of the following measures. */
  export function at(outline: readonly OutlineBlock[], position: number): KeySignature {
    let key: KeySignature = { fifths: 0 }, start = 0;
    for (const block of outline) {
      if (MusicalTime.compareNumbers(start, position) > 0) break;
      if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
      if (block.type === 'measure') {
        const end = MusicalTime.addNumbers(start, block.data.length.cnt / block.data.length.unit * 16);
        if (MusicalTime.compareNumbers(position, end) < 0) return key;
        start = end;
      }
    }
    return key;
  }
  export function forNote(outline: readonly OutlineBlock[], noteId: string): KeySignature {
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      if ([block.data.upperStaff, block.data.lowerStaff].some(staff => staff.voices.some(voice =>
        ScoreVoice.flatten(voice, block.data.length).some(entry => entry.element.id === noteId)))) return forBlock(outline, block.id);
    }
    return at(outline, 0);
  }

}
export default ScoreKey;
