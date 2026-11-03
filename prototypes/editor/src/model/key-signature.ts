/** Compatibility entry point. New production code uses domain APIs directly. */
export type { MeasureKeyContext } from '../domain/score/score-key.ts';
import KeyTheory from '../domain/theory/key-signature.ts';
export const getDiatonicPitchClasses = KeyTheory.pitchClasses;
export const getKeySignatureText = KeyTheory.label;
import ScoreKey from '../domain/score/score-key.ts';
export const buildMeasureKeyCache = ScoreKey.buildMeasureCache;
export const isDiatonicInMeasure = ScoreKey.contains;
export const getKeySignatureForBlock = ScoreKey.forBlock;
export const getKeySignatureAt = ScoreKey.at;
export const getNoteKeySignature = ScoreKey.forNote;
