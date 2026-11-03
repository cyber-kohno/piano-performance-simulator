
import ScoreArpeggio from "../score/score-arpeggio.ts";
import type { ArpeggioSettings, PianoPitch } from '../score/types.ts';

namespace ArpeggioPerformance {
  /** Derived playback offsets in the caller's time units. Negative offsets are intentional. */
  export function attacks(pitches: readonly PianoPitch[], settings: ArpeggioSettings, sixteenthDuration: number) {
    if (pitches.length < 2 || !ScoreArpeggio.validate(settings) || !Number.isFinite(sixteenthDuration) || sixteenthDuration <= 0) return [];
    const ordered = [...pitches].sort((a,b) => settings.type === 'normal' ? a.midi-b.midi : b.midi-a.midi);
    const step = sixteenthDuration * settings.spreadRatio / ordered.length;
    return ordered.map((pitch,index) => ({ midi:pitch.midi, offset:(index-settings.timing*(ordered.length-1))*step }));
  }
}
export default ArpeggioPerformance;
