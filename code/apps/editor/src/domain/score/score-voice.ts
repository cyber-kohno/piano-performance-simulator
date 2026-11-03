
import WrittenValue from "../theory/written-value.ts";
import MusicalTime from "../theory/musical-time.ts";
import type { PianoVoiceElement, MeasureLength, PianoVoice, PianoNote, PianoRest, PianoMeasureRest, PianoTuplet } from './types.ts';
import { type Rational } from "../theory/musical-time.ts";

namespace ScoreVoice {
  export function duration(element: PianoVoiceElement, measureLength: MeasureLength): number {
    return MusicalTime.toNumber(time(element, measureLength));
  }

  export function time(element: PianoVoiceElement, measureLength: MeasureLength): Rational {
    if (element.kind === 'measure-rest') return MusicalTime.create(measureLength.cnt * 16, measureLength.unit);
    if (element.kind === 'tuplet') {
      if (!Number.isSafeInteger(element.actual) || !Number.isSafeInteger(element.normal) || element.actual < 1 || element.normal < 1) throw new RangeError('Invalid tuplet ratio');
      const written = element.elements.reduce((sum, child) => MusicalTime.add(sum, time(child, measureLength)), MusicalTime.create(0));
      const expected = MusicalTime.multiply(MusicalTime.fromNumber(WrittenValue.sixteenths({ type: element.baseType, dots: 0 })), MusicalTime.create(element.actual));
      if (MusicalTime.compare(written, expected) !== 0) throw new RangeError('Incomplete tuplet group');
      return MusicalTime.multiply(written, MusicalTime.create(element.normal, element.actual));
    }
    return MusicalTime.fromNumber(WrittenValue.sixteenths(element.value));
  }

  export function locate(voice: PianoVoice, measureLength: MeasureLength) {
    let position = MusicalTime.create(0);
    return voice.elements.map((element, index) => {
      const length = time(element, measureLength);
      const entry = { element, index, positionTime: position, lengthTime: length, positionSixteenths: MusicalTime.toNumber(position), lengthSixteenths: MusicalTime.toNumber(length) };
      position = MusicalTime.add(position, length);
      return entry;
    });
  }

  export function flatten(voice: PianoVoice, measureLength: MeasureLength) {
    return locate(voice, measureLength).flatMap((entry) => {
      if (entry.element.kind !== 'tuplet') return [{ ...entry, element: entry.element as PianoNote | PianoRest | PianoMeasureRest, tuplet: undefined as PianoTuplet | undefined, childIndex: -1 }];
      const tuplet = entry.element;
      let position = entry.positionTime;
      return tuplet.elements.map((element, childIndex) => {
        const length = MusicalTime.multiply(time(element, measureLength), MusicalTime.create(tuplet.normal, tuplet.actual));
        const result = { ...entry, element, tuplet, childIndex, positionTime: position, lengthTime: length,
          positionSixteenths: MusicalTime.toNumber(position), lengthSixteenths: MusicalTime.toNumber(length) };
        position = MusicalTime.add(position, length);
        return result;
      });
    });
  }

  export function mapNotes(voice: PianoVoice, update: (note: PianoNote) => PianoNote | PianoRest): PianoVoice {
    return { ...voice, elements: voice.elements.map((element) => element.kind === 'note' ? update(element)
      : element.kind === 'tuplet' ? { ...element, elements: element.elements.map((child) => child.kind === 'note' ? update(child) : child) } : element) };
  }

}
export default ScoreVoice;
