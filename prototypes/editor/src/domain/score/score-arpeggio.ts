import type { ArpeggioSettings, PianoNote } from './types.ts';

namespace ScoreArpeggio {
  export const isTenthInRange = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
  export function validate(value: ArpeggioSettings): boolean {
    return ['normal', 'down'].includes(value.type) && isTenthInRange(value.spreadRatio, 0.1, 1) && isTenthInRange(value.timing, 0, 1);
  }
  export function canApply(note: PianoNote): boolean {
    return note.pitches.length >= 2 && note.value.type !== '32nd' && !note.tieFrom;
  }
}
export default ScoreArpeggio;
