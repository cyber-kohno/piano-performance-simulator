/** Compatibility aliases only; production consumers use the domain namespace APIs. */
import ScoreSlur from '../domain/score/score-slur.ts';
export const getSlurRanges = ScoreSlur.ranges;
export const getSlurActions = ScoreSlur.availability;
export const addSlur = ScoreSlur.add;
export const removeSlur = ScoreSlur.remove;
export const reconcileSlurs = ScoreSlur.reconcile;
