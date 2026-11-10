
import ScoreTempo from "../score/score-tempo.ts";
import type { ScoreProject } from '../score/types.ts';
import Meter from '../theory/meter.ts';
import ScoreFermata from '../score/score-fermata.ts';

type Clock = { secondsAt(position: number): number; positionAt(seconds: number): number };

namespace ScoreClock {
  /** Compile tempo anchors once; both conversions search the same cumulative table. */
  export function createTempo(project: ScoreProject): Clock {
    const beat = Meter.beatLength(project.outline[0].data.timeSignature);
    const beatLength = beat.cnt / beat.unit * 16;
    const segments = [{ position: 0, seconds: 0, secondsPerUnit: 60 / project.outline[0].data.tempo / beatLength }];
    for (const change of ScoreTempo.changes(project)) {
      const previous = segments[segments.length - 1];
      segments.push({ position: change.position,
        seconds: previous.seconds + (change.position - previous.position) * previous.secondsPerUnit,
        secondsPerUnit: 60 / change.bpm / beatLength });
    }
    function segment(value: number, field: 'position' | 'seconds') {
      let low = 0, high = segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (segments[middle][field] <= value) low = middle + 1;
        else high = middle;
      }
      return segments[Math.max(0, low - 1)];
    }
    return {
      secondsAt(position: number) {
        const entry = segment(position, 'position');
        return entry.seconds + (position - entry.position) * entry.secondsPerUnit;
      },
      positionAt(seconds: number) {
        const entry = segment(seconds, 'seconds');
        return entry.position + (seconds - entry.seconds) / entry.secondsPerUnit;
      },
    };
  }
  /** Warp base performance seconds, so every event and the cursor share one mapping. */
  export function withFermatas(tempo: Clock, groups: readonly {
    startSixteenths: number; endSixteenths: number; lengthRatio: number;
  }[]): Clock {
    const holds = groups.filter(group => group.lengthRatio !== 1);
    if (!holds.length) return tempo;
    const segments = [{ base: 0, performed: 0, rate: 1 }];
    const append = (base: number, rate: number) => {
      const previous = segments[segments.length - 1];
      segments.push({ base, performed: previous.performed + (base - previous.base) * previous.rate, rate });
    };
    for (const hold of holds) {
      append(tempo.secondsAt(hold.startSixteenths), hold.lengthRatio);
      append(tempo.secondsAt(hold.endSixteenths), 1);
    }
    function segment(value: number, field: 'base' | 'performed') {
      let low = 0, high = segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (segments[middle][field] <= value) low = middle + 1;
        else high = middle;
      }
      return segments[Math.max(0, low - 1)];
    }
    return {
      secondsAt(position) {
        const base = tempo.secondsAt(position), entry = segment(base, 'base');
        return entry.performed + (base - entry.base) * entry.rate;
      },
      positionAt(seconds) {
        const entry = segment(seconds, 'performed');
        return tempo.positionAt(entry.base + (seconds - entry.performed) / entry.rate);
      },
    };
  }
  export function create(project: ScoreProject): Clock {
    return withFermatas(createTempo(project), ScoreFermata.groups(project));
  }
  /** Integrate tempo and global fermata stretches, including inside sustained notes. */
  export function secondsAt(project: ScoreProject, position: number): number {
    return create(project).secondsAt(position);
  }
}
export default ScoreClock;
