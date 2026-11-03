
import RestSpelling from "./rest-spelling.ts";
import type { MeasureLength, MeasureBlock, PianoStaff } from './types.ts';

namespace ScoreMeasure {
  export function create(length: MeasureLength): MeasureBlock['data'] {
    const createStaff = (): PianoStaff => ({
      voices: [{ id: 'voice-0', elements: [{ id: RestSpelling.createId(), kind: 'measure-rest' }] }],
    });
    return { length: { ...length }, upperStaff: createStaff(), lowerStaff: createStaff(), pedalEvents: [] };
  }

}
export default ScoreMeasure;
