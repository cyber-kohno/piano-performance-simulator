import type { GracePerformanceSettings, PianoGraceNote } from '../score/types.ts';

namespace GraceNotePerformance {
  export const defaults: GracePerformanceSettings = { spreadRatio: 0.5, timing: 1 };

  /** Even grace-note attacks in the same sixteenth-based window used by arpeggios. */
  export function attacks(graces: readonly PianoGraceNote[], settings: GracePerformanceSettings, sixteenthSeconds: number) {
    if (!graces.length || !Number.isFinite(sixteenthSeconds) || sixteenthSeconds <= 0 ||
      !Number.isFinite(settings.spreadRatio) || settings.spreadRatio < 0.1 || settings.spreadRatio > 1 ||
      !Number.isFinite(settings.timing) || settings.timing < 0 || settings.timing > 1) return [];
    const step = sixteenthSeconds * settings.spreadRatio / graces.length;
    return graces.map((grace, index) => ({
      midi: grace.pitches[0].midi,
      offset: (index - settings.timing * (graces.length - 1)) * step,
      duration: step,
    }));
  }
}

export default GraceNotePerformance;
