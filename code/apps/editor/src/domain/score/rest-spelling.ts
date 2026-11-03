
import NotationGrid from "./notation-grid.ts";
import type { PianoRest, NoteValue } from './types.ts';
import WrittenValue from '../theory/written-value.ts';

namespace RestSpelling {
  export function createId(): string {
    return `rest-${crypto.randomUUID()}`;
  }

  /** Default spelling for a newly exposed rest span; existing rests outside it stay intact. */
  export function create(start: number, length: number): PianoRest[] {
    if (!NotationGrid.contains(start) || !NotationGrid.contains(length) || start < 0 || length < 0) {
      throw new RangeError('Rest spans must use the thirty-second-note editing grid.');
    }
    const values = WrittenValue.entries();
    const result: PianoRest[] = [];
    let position = start;
    let remaining = length;
    while (remaining > 0) {
      const [type, steps] = values.find(([, steps]) => steps <= remaining && position % steps === 0)!;
      result.push({ id: createId(), kind: 'rest', value: { type, dots: 0 } });
      position += steps;
      remaining -= steps;
    }
    return result;
  }

}
export default RestSpelling;
