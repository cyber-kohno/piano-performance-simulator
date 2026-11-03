import type { ScoreProject, StaccatoSettings } from '../score/types.ts';
import ScoreClock from './score-clock.ts';

namespace StaccatoPerformance {
  /** Returns the sound end time while preserving written note positions in the score. */
  export function soundingEndSeconds(
    project: ScoreProject,
    writtenEndPosition: number,
    articulatedSegmentStart: number,
    articulatedSegmentLength: number,
    settings?: StaccatoSettings,
  ): number {
    const writtenEndSeconds = ScoreClock.secondsAt(project, writtenEndPosition);
    if (!settings) return writtenEndSeconds;
    const segmentEnd = articulatedSegmentStart + articulatedSegmentLength;
    const segmentSeconds = ScoreClock.secondsAt(project, segmentEnd) - ScoreClock.secondsAt(project, articulatedSegmentStart);
    return writtenEndSeconds - segmentSeconds * (1 - settings.lengthRatio);
  }
}
export default StaccatoPerformance;
