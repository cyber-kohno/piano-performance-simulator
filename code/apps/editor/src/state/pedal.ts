import ScorePedal from '../domain/score/score-pedal.ts';
import MusicalTime from '../domain/theory/musical-time.ts';
import WrittenValue from '../domain/theory/written-value.ts';
import type { ScoreProject, NoteValue } from '../domain/score/types.ts';
export type PedalCursor = { position: number; value: NoteValue };
export const createPedalCursor = (): PedalCursor => ({ position: 0, value: { type: 'quarter', dots: 0 } });

export function movePedalCursor(project: ScoreProject, cursor: PedalCursor, direction: -1 | 1): PedalCursor {
  return {
    ...cursor, position: Math.max(0, Math.min(getPedalLength(project),
      MusicalTime.addNumbers(cursor.position, direction * WrittenValue.sixteenths(cursor.value))))
  };
}

export const getPedalMeasures = ScorePedal.measures;
export const getPedalLength = ScorePedal.length;
export const getPedalEvents = ScorePedal.events;
export const addPedalEvent = ScorePedal.add;
export const deletePedalEvent = ScorePedal.remove;
export const getPedalSpans = ScorePedal.spans;
export const reconcilePedalOutline = ScorePedal.reconcile;
