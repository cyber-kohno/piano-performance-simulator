
import ScoreTempo from "../score/score-tempo.ts";
import type { ScoreProject } from '../score/types.ts';
import Meter from '../theory/meter.ts';

namespace ScoreClock {
  /** Integrate the shared tempo map, including changes inside sustained notes. */
  export function secondsAt(project: ScoreProject, position: number): number {
    const beat = Meter.beatLength(project.outline[0].data.timeSignature);
    const beatLength = beat.cnt / beat.unit * 16;
    let at = 0, seconds = 0, bpm = project.outline[0].data.tempo;
    for (const change of ScoreTempo.changes(project)) {
      // Playback position is a binary-search result and may be an approximate
      // decimal. Keep the exact-fraction comparison for score data, not runtime time.
      if (change.position >= position) break;
      seconds += (change.position - at) / beatLength * 60 / bpm;
      at = change.position; bpm = change.bpm;
    }
    return seconds + (position - at) / beatLength * 60 / bpm;
  }
}
export default ScoreClock;
