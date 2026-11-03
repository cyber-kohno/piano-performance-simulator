export type PlaybackInstrumentPort = {
  play(pitches: readonly number[], velocity: number, durationMs: number): void;
  setSustainPedal(down: boolean): void;
  stop(): void;
  dispose(): void;
};
