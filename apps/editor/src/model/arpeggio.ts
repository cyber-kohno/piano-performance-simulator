import type { ArpeggioSettings, PianoNote, PianoPitch } from './project.ts';

export const isTenthInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max &&
  Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
export function isValidArpeggio(value: ArpeggioSettings): boolean {
  return ['normal', 'down'].includes(value.type) && isTenthInRange(value.spreadRatio, 0.1, 1) && isTenthInRange(value.timing, 0, 1);
}
export function canApplyArpeggio(note: PianoNote): boolean {
  return note.pitches.length >= 2 && note.value.type !== '32nd' && !note.tieFrom;
}
/** Derived playback offsets in the caller's time units. Negative offsets are intentional. */
export function getArpeggioAttacks(pitches: readonly PianoPitch[], settings: ArpeggioSettings, sixteenthDuration: number) {
  if (pitches.length < 2 || !isValidArpeggio(settings) || !Number.isFinite(sixteenthDuration) || sixteenthDuration <= 0) return [];
  const ordered = [...pitches].sort((a,b) => settings.type === 'normal' ? a.midi-b.midi : b.midi-a.midi);
  const step = sixteenthDuration * settings.spreadRatio / ordered.length;
  return ordered.map((pitch,index) => ({ midi:pitch.midi, offset:(index-settings.timing*(ordered.length-1))*step }));
}
