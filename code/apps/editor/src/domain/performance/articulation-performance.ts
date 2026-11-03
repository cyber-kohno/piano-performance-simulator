namespace ArticulationPerformance {
  /** Initial playback defaults. Ratios are based on the interval between note onsets. */
  export const defaults = {
    unslurredGapRatio: 0.05,
    slurredOverlapRatio: 0.08,
    maxSlurredOverlapSeconds: 0.03,
  } as const;

  /** Target sounding end for the preceding tone at a continuous note transition. */
  export function transitionEndSeconds(nextOnsetSeconds: number, interOnsetIntervalSeconds: number,
    slurred: boolean, samePitch: boolean): number {
    if (slurred) {
      if (samePitch) return nextOnsetSeconds;
      const overlap = Math.min(interOnsetIntervalSeconds * defaults.slurredOverlapRatio,
        defaults.maxSlurredOverlapSeconds);
      return nextOnsetSeconds + overlap;
    }
    return nextOnsetSeconds - interOnsetIntervalSeconds * defaults.unslurredGapRatio;
  }
}
export default ArticulationPerformance;
