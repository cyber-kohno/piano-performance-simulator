import MusicalTime from '../domain/theory/musical-time.ts';
import WrittenValue from '../domain/theory/written-value.ts';
import ScoreOttava from '../domain/score/score-ottava.ts';
import type { NoteValue, PianoStaffName, ScoreProject } from '../domain/score/types.ts';

export type OttavaCursor = { position: number; value: NoteValue };
export const createOttavaCursor = (): OttavaCursor => ({ position: 0, value: { type: 'quarter', dots: 0 } });
export function moveOttavaCursor(project: ScoreProject, cursor: OttavaCursor, direction: -1 | 1): OttavaCursor {
  return { ...cursor, position: Math.max(0, Math.min(ScoreOttava.length(project),
    MusicalTime.addNumbers(cursor.position, direction * WrittenValue.sixteenths(cursor.value)))) };
}
export const getOttavaEvents = ScoreOttava.events;
export const getOttavaSpans = ScoreOttava.spans;
export type { PianoStaffName };
