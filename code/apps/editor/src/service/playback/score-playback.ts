import type { PlaybackInstrumentPort } from './playback-instrument.ts';
import ScorePlaybackPlan from '../../domain/performance/score-playback-plan.ts';
import ScoreClock from '../../domain/performance/score-clock.ts';
import type { ScoreProject } from '../../domain/score/types.ts';

namespace ScorePlayback {
  export type Value = {
    readonly playing: boolean;
    start(project: ScoreProject, startPosition: number, onPosition: (position: number) => void, onStop: () => void): boolean;
    stop(): void;
    dispose(): void;
  };

  export function create(instrument: PlaybackInstrumentPort): Value {
    let playing = false;
    let generation = 0;
    let timers: number[] = [];
    let progressTimer: number | undefined;
    let onPosition: ((position: number) => void) | undefined;
    let onStop: (() => void) | undefined;
    let plan: ReturnType<typeof ScorePlaybackPlan.create> | undefined;
    let startedAt = 0;
    const value: Value = {
      get playing() { return playing; },
      start(project, startPosition, updatePosition, stopped) {
        if (playing) return false;
        const nextPlan = ScorePlaybackPlan.create(project, startPosition);
        if (nextPlan.durationSeconds <= 0 || nextPlan.events.length === 0) return false;
        instrument.stop();
        plan = nextPlan;
        onPosition = updatePosition;
        onStop = stopped;
        playing = true;
        const session = ++generation;
        startedAt = performance.now();
        instrument.setSustainPedal(nextPlan.pedalInitiallyDown);
        const emitProgress = () => {
          if (!playing || session !== generation || !plan) return;
          const elapsed = Math.min((performance.now() - startedAt) / 1000, plan.durationSeconds);
          const targetSeconds = ScoreClock.secondsAt(project, plan.startPosition) + elapsed;
          let low = plan.startPosition, high = plan.endPosition;
          for (let i = 0; i < 24; i++) {
            const middle = (low + high) / 2;
            if (ScoreClock.secondsAt(project, middle) < targetSeconds) low = middle;
            else high = middle;
          }
          onPosition?.(Math.min(plan.endPosition, (low + high) / 2));
        };
        for (const event of nextPlan.pedalEvents) {
          const timer = window.setTimeout(() => {
            if (!playing || session !== generation) return;
            if (event.action === 'start') instrument.setSustainPedal(true);
            else if (event.action === 'stop') instrument.setSustainPedal(false);
            else {
              instrument.setSustainPedal(false);
              instrument.setSustainPedal(true);
            }
          }, Math.max(0, event.atSeconds * 1000));
          timers.push(timer);
        }
        for (const event of nextPlan.events) {
          const timer = window.setTimeout(() => {
            if (!playing || session !== generation) return;
            if (event.pitchDurationsSeconds?.length === event.pitches.length) {
              event.pitches.forEach((pitch, index) => instrument.play([pitch], 88,
                Math.max(1, event.pitchDurationsSeconds![index] * 1000)));
            } else instrument.play(event.pitches, 88, Math.max(1, event.durationSeconds * 1000));
          }, Math.max(0, event.startSeconds * 1000));
          timers.push(timer);
        }
        progressTimer = window.setInterval(emitProgress, 50);
        const endTimer = window.setTimeout(() => value.stop(), nextPlan.durationSeconds * 1000);
        timers.push(endTimer);
        emitProgress();
        return true;
      },
      stop() {
        if (!playing) return;
        playing = false;
        generation++;
        for (const timer of timers) window.clearTimeout(timer);
        timers = [];
        if (progressTimer !== undefined) window.clearInterval(progressTimer);
        progressTimer = undefined;
        instrument.stop();
        plan = undefined;
        onPosition = undefined;
        const stopped = onStop;
        onStop = undefined;
        stopped?.();
      },
      dispose() { value.stop(); },
    };
    return value;
  }
}
export default ScorePlayback;
