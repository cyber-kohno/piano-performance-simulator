/** Compatibility aliases only; production consumers use the domain namespace APIs. */
import TrillPitch from '../domain/theory/trill-pitch.ts';
export const getTrillAuxiliary = TrillPitch.above;
import ScoreTrill from '../domain/score/score-trill.ts';
export const DEFAULT_TRILL = ScoreTrill.defaults;
export const isValidTrill = ScoreTrill.validate;
export const getTrillNotes = ScoreTrill.notes;
export const getTrillChain = ScoreTrill.chain;
export const getNoteTrill = ScoreTrill.forNote;
export const canApplyTrill = ScoreTrill.canApply;
export const setNoteTrill = ScoreTrill.set;
export const reconcileTrills = ScoreTrill.reconcile;
import TrillPerformance from '../domain/performance/trill-performance.ts';
export const getTrillAttacks = TrillPerformance.attacks;
