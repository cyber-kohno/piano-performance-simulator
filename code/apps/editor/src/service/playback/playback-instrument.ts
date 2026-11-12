import type { PlaybackPlan } from '../../domain/performance/score-playback-plan.ts';

export type PlaybackSequence = Pick<PlaybackPlan, 'events' | 'pedalEvents' | 'pedalInitiallyDown' | 'durationSeconds'>;
export type SequenceRun = { readonly ready?: boolean; readonly currentTime: number };
export type SequenceCallbacks = { ended(): void; failed(error: unknown): void };

export type PlaybackInstrumentPort = {
  startSequence(sequence: PlaybackSequence, callbacks: SequenceCallbacks): SequenceRun;
  play(pitches: readonly number[], velocity: number, durationMs: number): void;
  setSustainPedal(down: boolean): void;
  stop(): void;
  dispose(): void;
};
