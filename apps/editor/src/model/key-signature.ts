import { getFlattenedVoiceElements, type OutlineBlock, type KeySignature } from './project.ts';
import { addTime, compareTime } from './rational.ts';

export function getDiatonicPitchClasses(keySignature: KeySignature): Set<number> {
  const naturalPitchClasses = [0, 2, 4, 5, 7, 9, 11];
  const fifths = keySignature.fifths;
  const order = fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
  const altered = new Set(order.slice(0, Math.abs(fifths)));
  return new Set(naturalPitchClasses.map((pitch, step) =>
    (pitch + (altered.has(step) ? Math.sign(fifths) : 0) + 12) % 12,
  ));
}

export type MeasureKeyContext = { keySignature: KeySignature; pitchClasses: ReadonlySet<number> };
/** Derived cache, never saved: one outline pass; identical keys share scale data.
 * No cursor dependency, so moving the cursor cannot recolor existing measures.
 */
export function buildMeasureKeyCache(outline: readonly OutlineBlock[]): ReadonlyMap<string, MeasureKeyContext> {
  const result = new Map<string, MeasureKeyContext>();
  const contexts = new Map<number, MeasureKeyContext>();
  let key: KeySignature = { fifths: 0 };
  for (const block of outline) {
    if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
    if (block.type !== 'measure') continue;
    let context = contexts.get(key.fifths);
    if (!context) {
      context = { keySignature: { ...key }, pitchClasses: getDiatonicPitchClasses(key) };
      contexts.set(key.fifths, context);
    }
    result.set(block.id, context);
  }
  return result;
}
export function isDiatonicInMeasure(cache: ReadonlyMap<string, MeasureKeyContext>, measureId: string, midi: number): boolean {
  return cache.get(measureId)?.pitchClasses.has(((midi % 12) + 12) % 12) ?? false;
}

export function getKeySignatureForBlock(outline: readonly OutlineBlock[], blockId: string): KeySignature {
  let key: KeySignature = { fifths: 0 };
  for (const block of outline) {
    if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
    if (block.id === blockId) break;
  }
  return key;
}
/** Zero-duration outline changes apply at the head of the following measures. */
export function getKeySignatureAt(outline: readonly OutlineBlock[], position: number): KeySignature {
  let key: KeySignature = { fifths: 0 }, start = 0;
  for (const block of outline) {
    if (compareTime(start, position) > 0) break;
    if (block.type === 'init' || block.type === 'key-change') key = block.data.keySignature;
    if (block.type === 'measure') {
      const end = addTime(start, block.data.length.cnt / block.data.length.unit * 16);
      if (compareTime(position, end) < 0) return key;
      start = end;
    }
  }
  return key;
}
export function getNoteKeySignature(outline: readonly OutlineBlock[], noteId: string): KeySignature {
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    if ([block.data.upperStaff, block.data.lowerStaff].some(staff => staff.voices.some(voice =>
      getFlattenedVoiceElements(voice, block.data.length).some(entry => entry.element.id === noteId)))) return getKeySignatureForBlock(outline, block.id);
  }
  return getKeySignatureAt(outline, 0);
}
export function getKeySignatureText(key: KeySignature): string {
  const count = Math.abs(key.fifths);
  return count === 0 ? 'None' : `${count} ${key.fifths > 0 ? 'sharp' : 'flat'}${count === 1 ? '' : 's'}`;
}
