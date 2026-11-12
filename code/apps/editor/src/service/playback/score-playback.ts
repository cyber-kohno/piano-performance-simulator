import type { PlaybackInstrumentPort } from './playback-instrument.ts';
import ScorePlaybackPlan from '../../domain/performance/score-playback-plan.ts';
import type { ScoreProject } from '../../domain/score/types.ts';

namespace ScorePlayback {
  export type Value = {
    readonly playing: boolean;
    readonly position: number | null;
    invalidate(project: ScoreProject): void;
    prepare(project: ScoreProject): void;
    start(project: ScoreProject, startPosition: number, onPosition: (position: number) => void, onStop: () => void): boolean;
    stop(): void;
    dispose(): void;
  };

  export function create(instrument: PlaybackInstrumentPort): Value {
    let playing = false;
    let generation = 0;
    let progressTimer: number | undefined;
    let onPosition: ((position: number) => void) | undefined;
    let onStop: (() => void) | undefined;
    let preparedProject: ScoreProject | undefined;
    let prepared: ReturnType<typeof ScorePlaybackPlan.prepare> | undefined;
    let cachedPlan: ReturnType<typeof ScorePlaybackPlan.create> | undefined;
    let positionNow: (() => number) | undefined;
    const value: Value = {
      get playing() { return playing; },
      get position() { return playing ? positionNow?.() ?? null : null; },
      invalidate(project) {
        if (preparedProject === project) return;
        // Edits only discard old derived data. Rebuild on the next start.
        preparedProject = undefined;
        prepared = undefined;
        cachedPlan = undefined;
      },
      prepare(project) {
        if (preparedProject === project) return;
        prepared = ScorePlaybackPlan.prepare(project);
        preparedProject = project;
        cachedPlan = undefined;
      },
      start(project, startPosition, updatePosition, stopped) {
        if (playing) return false;
        value.prepare(project);
        const snapshot = prepared!;
        const nextPlan = cachedPlan?.startPosition === startPosition ? cachedPlan : snapshot.create(startPosition);
        cachedPlan = nextPlan;
        if (nextPlan.durationSeconds <= 0 || nextPlan.events.length === 0) return false;
        onPosition = updatePosition;
        onStop = stopped;
        playing = true;
        const session = ++generation;
        const startSeconds = snapshot.clock.secondsAt(nextPlan.startPosition);
        try {
          const run = instrument.startSequence(nextPlan, {
            ended() { if (playing && session === generation) value.stop(); },
            failed(error) {
              if (!playing || session !== generation) return;
              console.error('Score playback:', error);
              value.stop();
            },
          });
          positionNow = () => Math.max(nextPlan.startPosition, Math.min(nextPlan.endPosition,
            snapshot.clock.positionAt(startSeconds + run.currentTime)));
        } catch (error) {
          console.error('Score playback:', error);
          value.stop();
          return false;
        }
        const emitProgress = () => {
          if (!playing || session !== generation || !positionNow) return;
          onPosition?.(positionNow());
        };
        // Only the UI is polled. Notes, pedal and sequence completion run in audio.
        progressTimer = window.setInterval(emitProgress, 50);
        emitProgress();
        return true;
      },
      stop() {
        if (!playing) return;
        playing = false;
        generation++;
        if (progressTimer !== undefined) window.clearInterval(progressTimer);
        progressTimer = undefined;
        instrument.stop();
        positionNow = undefined;
        onPosition = undefined;
        const stopped = onStop;
        onStop = undefined;
        stopped?.();
      },
      dispose() {
        value.stop();
        preparedProject = undefined;
        prepared = undefined;
        cachedPlan = undefined;
      },
    };
    return value;
  }
}
export default ScorePlayback;
