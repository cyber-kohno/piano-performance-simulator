
import RestSpelling from "./rest-spelling.ts";
import ScoreVoice from './score-voice.ts';
import type { MeasureLength, MeasureBlock, PianoStaff } from './types.ts';

namespace ScoreMeasure {
  export function create(length: MeasureLength): MeasureBlock['data'] {
    const createStaff = (): PianoStaff => ({
      voices: [{ id: 'voice-0', elements: [{ id: RestSpelling.createId(), kind: 'measure-rest' }] }],
    });
    return { length: { ...length }, upperStaff: createStaff(), lowerStaff: createStaff(), pedalEvents: [] };
  }

  export function hasNotes(data: MeasureBlock['data']): boolean {
    return [data.upperStaff, data.lowerStaff].some(staff => staff.voices.some(voice =>
      ScoreVoice.flatten(voice, data.length).some(entry => entry.element.kind === 'note'),
    ));
  }

}
export default ScoreMeasure;
