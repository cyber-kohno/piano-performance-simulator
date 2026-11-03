/** Compatibility aliases only; production consumers use the domain namespace APIs. */
import ScoreArpeggio from '../domain/score/score-arpeggio.ts';
export const isTenthInRange = ScoreArpeggio.isTenthInRange;
export const isValidArpeggio = ScoreArpeggio.validate;
export const canApplyArpeggio = ScoreArpeggio.canApply;
import ArpeggioPerformance from '../domain/performance/arpeggio-performance.ts';
export const getArpeggioAttacks = ArpeggioPerformance.attacks;
