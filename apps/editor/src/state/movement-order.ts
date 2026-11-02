import { addTime, compareTime } from '../model/rational.ts';

type Span = { start: number; length: number };
/** Check the entire swept interval so movement cannot skip a stationary note.
 * Callers exclude every moving note from stationary, including tied successors.
 * Half-open intervals allow the destination to touch a neighbor exactly.
 */
export function crossesStationaryNote(moving: readonly Span[], stationary: readonly Span[], shift: number): boolean {
  return moving.some(note => {
    const start = shift < 0 ? addTime(note.start, shift) : note.start;
    const end = addTime(addTime(note.start, note.length), shift > 0 ? shift : 0);
    return stationary.some(other => compareTime(start, addTime(other.start, other.length)) < 0 && compareTime(end, other.start) > 0);
  });
}
