
import ScoreTempo from "../score/score-tempo.ts";
import type { ScoreProject } from '../score/types.ts';
import Meter from '../theory/meter.ts';
import MusicalTime from '../theory/musical-time.ts';

namespace ScoreClock {
  /** Integrate the shared tempo map, including changes inside sustained notes. */
  export function secondsAt(project: ScoreProject, position: number): number {
    const beat = Meter.beatLength(project.outline[0].data.timeSignature);
    const beatLength = beat.cnt / beat.unit * 16;
    let at = 0, seconds = 0, bpm = project.outline[0].data.tempo;
    for (const change of ScoreTempo.changes(project)) {
      if (MusicalTime.compareNumbers(change.position, position) >= 0) break;
      seconds += (change.position - at) / beatLength * 60 / bpm;
      at = change.position; bpm = change.bpm;
    }
    return seconds + (position - at) / beatLength * 60 / bpm;
  }
}
export default ScoreClock;
