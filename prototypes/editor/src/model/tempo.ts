/** Compatibility aliases only; production consumers use the domain namespace APIs. */
import ScoreTempo from '../domain/score/score-tempo.ts';
export const getTempoAnchors = ScoreTempo.anchors;
export const getTempoChanges = ScoreTempo.changes;
export const setNoteTempo = ScoreTempo.set;
export const reconcileTempoChanges = ScoreTempo.reconcile;
export const getTempoAt = ScoreTempo.at;
import ScoreClock from '../domain/performance/score-clock.ts';
export const getScoreTimeSeconds = ScoreClock.secondsAt;
