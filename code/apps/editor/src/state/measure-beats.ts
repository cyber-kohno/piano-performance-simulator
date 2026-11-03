
import Meter from "../domain/theory/meter.ts";
import type { MeasureLength, TimeSignature } from "../domain/score/types.ts";

function formatBeatCount(numerator: number, denominator: number): string {
  let a = numerator;
  let b = denominator;
  while (b !== 0) [a, b] = [b, a % b];
  const reducedNumerator = numerator / a;
  const reducedDenominator = denominator / a;
  return reducedDenominator === 1 ? String(reducedNumerator) : `(${reducedNumerator}/${reducedDenominator})`;
}

/** Outline display only: the saved length remains a fraction of a whole note. */
export function getMeasureBeatDisplay(meter: TimeSignature, length: MeasureLength) {
  const divisionsPerBeat = Meter.beatLength(meter).cnt;
  const standardBeats = meter.cnt / divisionsPerBeat;
  const numerator = length.cnt * meter.unit;
  const denominator = length.unit * divisionsPerBeat;
  const actualBeats = numerator / denominator;
  return {
    actualBeats,
    standardBeats,
    actualLabel: formatBeatCount(numerator, denominator),
    // Preserve short/partial bars and show extra beats in existing overlong bars.
    chips: Array.from({ length: Math.max(standardBeats, Math.ceil(actualBeats)) }, (_, index) =>
      Math.max(0, Math.min(1, actualBeats - index)),
    ),
  };
}

export const getMeterBeatLength = Meter.beatLength;
