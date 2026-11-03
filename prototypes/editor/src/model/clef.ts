/** Compatibility aliases only; production consumers use the domain namespace APIs. */
export type { Clef } from '../domain/score/score-clef.ts';
import ScoreClef from '../domain/score/score-clef.ts';
export const getClefAnchors = ScoreClef.anchors;
export const getClefChanges = ScoreClef.changes;
export const getClefAt = ScoreClef.at;
export const setNoteClef = ScoreClef.set;
export const reconcileClefChanges = ScoreClef.reconcile;
