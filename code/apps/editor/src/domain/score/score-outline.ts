
import ScoreKey from "./score-key.ts";
import MusicalTime from "../theory/musical-time.ts";
import Meter from "../theory/meter.ts";
import ScoreTies from "./score-ties.ts";
import ScoreVoice from "./score-voice.ts";
import RestSpelling from "./rest-spelling.ts";
import ScoreMeasure from "./score-measure.ts";
import { type KeySignature, type PianoStaff, type ScoreProject } from "./types.ts";

import ScorePedal from './score-pedal.ts';
import ScoreOttava from './score-ottava.ts';



namespace ScoreOutline {
  function clearSpellingDirections(outline: ScoreProject['outline']): ScoreProject['outline'] {
    const clearNote = (note: import('./types.ts').PianoNote) => ({
      ...note,
      pitches: note.pitches.map(({ spellingDirection: _direction, ...pitch }) => pitch),
      ...(note.beforeGraceNotes ? { beforeGraceNotes: note.beforeGraceNotes.map(grace => ({
        ...grace, pitches: grace.pitches.map(({ spellingDirection: _direction, ...pitch }) => pitch),
      })) } : {}),
    });
    return outline.map(block => block.type !== 'measure' ? block : ({
      ...block, data: {
        ...block.data,
        upperStaff: { voices: block.data.upperStaff.voices.map(voice => ({ ...voice, elements: voice.elements.map(element =>
          element.kind === 'note' ? clearNote(element) : element.kind === 'tuplet' ? { ...element, elements: element.elements.map(child => child.kind === 'note' ? clearNote(child) : child) } : element,
        ) })) },
        lowerStaff: { voices: block.data.lowerStaff.voices.map(voice => ({ ...voice, elements: voice.elements.map(element =>
          element.kind === 'note' ? clearNote(element) : element.kind === 'tuplet' ? { ...element, elements: element.elements.map(child => child.kind === 'note' ? clearNote(child) : child) } : element,
        ) })) },
      },
    })) as ScoreProject['outline'];
  }
  // C, G, D, A, E, B, Cb, F#, Gb, C#, Db, Ab, Eb, Bb, F.
  const INITIAL_KEY_SIGNATURE_ORDER: readonly KeySignature['fifths'][] = [
    0, 1, 2, 3, 4, 5, -7, 6, -6, 7, -5, -4, -3, -2, -1,
  ];

  export function changeInitialKey(
    outline: ScoreProject['outline'], blockId: string, direction: -1 | 1,
  ): ScoreProject['outline'] {
    const initial = outline[0];
    if (blockId !== initial.id) return outline;
    const index = INITIAL_KEY_SIGNATURE_ORDER.indexOf(initial.data.keySignature.fifths);
    if (index < 0) return outline;
    const fifths = INITIAL_KEY_SIGNATURE_ORDER[
      (index + direction + INITIAL_KEY_SIGNATURE_ORDER.length) % INITIAL_KEY_SIGNATURE_ORDER.length
    ];
    return clearSpellingDirections([{
      ...initial,
      data: { ...initial.data, keySignature: { ...initial.data.keySignature, fifths } },
    }, ...outline.slice(1)] as ScoreProject['outline']);
  }

  export function changeKey(outline: ScoreProject['outline'], blockId: string, direction: -1 | 1): ScoreProject['outline'] {
    const block = outline.find(entry => entry.id === blockId);
    if (block?.type === 'init') return changeInitialKey(outline, blockId, direction);
    if (block?.type !== 'key-change') return outline;
    const index = INITIAL_KEY_SIGNATURE_ORDER.indexOf(block.data.keySignature.fifths);
    if (index < 0) return outline;
    const fifths = INITIAL_KEY_SIGNATURE_ORDER[(index + direction + INITIAL_KEY_SIGNATURE_ORDER.length) % INITIAL_KEY_SIGNATURE_ORDER.length];
    return clearSpellingDirections(outline.map(entry => entry.id === block.id ? { ...block, data: { keySignature: { fifths } } } : entry) as ScoreProject['outline']);
  }

  export function addKeyChange(outline: ScoreProject['outline'], blockId: string) {
    const index = outline.findIndex(entry => entry.id === blockId);
    // Keep the required leading section, just as measure insertion does.
    if (index < 1) return { outline, blockId };
    const block = {
      id: `key-change-${crypto.randomUUID()}`, type: 'key-change' as const,
      data: { keySignature: { ...ScoreKey.forBlock(outline, blockId) } }
    };
    const next = [...outline]; next.splice(index + 1, 0, block);
    return { outline: next as ScoreProject['outline'], blockId: block.id };
  }

  export function changeTempo(
    outline: ScoreProject['outline'], blockId: string, direction: -1 | 1,
  ): ScoreProject['outline'] {
    const initial = outline[0];
    if (blockId !== initial.id) return outline;
    const tempo = Math.max(10, Math.min(400, initial.data.tempo + direction));
    if (tempo === initial.data.tempo) return outline;
    return [{ ...initial, data: { ...initial.data, tempo } }, ...outline.slice(1)] as ScoreProject['outline'];
  }

  const INITIAL_METER_NUMERATORS = { 4: [2, 3, 4], 8: [3, 6, 9, 12] } as const;

  export function changeMeter(
    outline: ScoreProject['outline'], blockId: string, part: 'numerator' | 'denominator', direction: -1 | 1,
  ): ScoreProject['outline'] {
    const initial = outline[0];
    if (blockId !== initial.id || outline.some((block) => block.type === 'measure')) return outline;
    const meter = initial.data.timeSignature;
    if (meter.unit !== 4 && meter.unit !== 8) return outline;
    const candidates: readonly number[] = INITIAL_METER_NUMERATORS[meter.unit];
    const index = candidates.indexOf(meter.cnt);
    if (index < 0) return outline;
    let unit: number = meter.unit;
    let cnt = meter.cnt;
    if (part === 'numerator') {
      const next = candidates[index + direction];
      if (next === undefined) return outline;
      cnt = next;
    } else if (part === 'denominator' && direction === -1 && meter.unit === 8) {
      unit = 4;
      cnt = meter.cnt === 3 ? 3 : meter.cnt / 3;
    } else if (part === 'denominator' && direction === 1 && meter.unit === 4) {
      unit = 8;
      cnt = meter.cnt * 3;
    } else return outline;
    return [{ ...initial, data: { ...initial.data, timeSignature: { unit, cnt } } }, ...outline.slice(1)] as ScoreProject['outline'];
  }

  /** Resize one measure by a perceived beat, preserving every note and all unaffected rest spelling. */
  export function changeMeasureBeats(
    outline: ScoreProject['outline'], blockId: string, direction: -1 | 1,
  ): ScoreProject['outline'] {
    const block = outline.find((entry) => entry.id === blockId);
    if (!block || block.type !== 'measure') return outline;
    const meter = outline[0].data.timeSignature;
    const beat = Meter.beatLength(meter);
    const step = beat.cnt / beat.unit * 16;
    const oldLength = block.data.length.cnt / block.data.length.unit * 16;
    const nextLength = oldLength + direction * step;
    const standardLength = meter.cnt / meter.unit * 16;
    if (!Number.isInteger(nextLength) || nextLength < step || nextLength > standardLength) return outline;
    if (block.data.pedalEvents?.some(event => MusicalTime.toNumber(event.offset) > nextLength ||
      (MusicalTime.toNumber(event.offset) === nextLength && event.action !== 'stop'))) return outline;
    if (block.data.ottavaEvents?.some(event => MusicalTime.toNumber(event.offset) > nextLength ||
      (MusicalTime.toNumber(event.offset) === nextLength && event.action !== 'stop'))) return outline;

    // Check every voice before rebuilding anything; shortening never truncates notes.
    if (direction === -1 && [block.data.upperStaff, block.data.lowerStaff].some((staff) => staff.voices.some((voice) =>
      ScoreVoice.locate(voice, block.data.length).some((entry) =>
        (entry.element.kind === 'note' || entry.element.kind === 'tuplet') && entry.positionSixteenths + entry.lengthSixteenths > nextLength,
      ),
    ))) return outline;

    const resizeStaff = (staff: PianoStaff): PianoStaff => ({
      ...staff,
      voices: staff.voices.map((voice) => {
        // A full-measure rest automatically takes the new actual measure length.
        if (voice.elements.length === 1 && voice.elements[0].kind === 'measure-rest') return voice;
        if (direction === 1) return {
          ...voice, elements: [...voice.elements, ...RestSpelling.create(oldLength, nextLength - oldLength)],
        };
        return {
          ...voice,
          elements: ScoreVoice.locate(voice, block.data.length).flatMap((entry) => {
            if (entry.positionSixteenths >= nextLength) return [];
            if (entry.positionSixteenths + entry.lengthSixteenths <= nextLength) return [entry.element];
            return RestSpelling.create(entry.positionSixteenths, nextLength - entry.positionSixteenths);
          }),
        };
      }),
    });
    let divisor = nextLength;
    let remainder = 16;
    while (remainder !== 0) [divisor, remainder] = [remainder, divisor % remainder];
    const changed = {
      ...block,
      data: {
        ...block.data,
        length: { cnt: nextLength / divisor, unit: 16 / divisor },
        upperStaff: resizeStaff(block.data.upperStaff),
        lowerStaff: resizeStaff(block.data.lowerStaff),
      },
    };
    const next = outline.map((entry) => entry.id === block.id ? changed : entry) as ScoreProject['outline'];
    return ScoreTies.reconcile(next);
  }

  export function remove(
    outline: ScoreProject['outline'],
    blockId: string,
  ): { outline: ScoreProject['outline']; blockId: string } {
    const index = outline.findIndex((block) => block.id === blockId);
    if (index < 0 || outline[index].type === 'init') {
      return { outline, blockId };
    }

    const removesKey = outline[index].type === 'key-change';
    const nextOutline = [...outline];
    nextOutline.splice(index, 1);
    // An adjacent section may replace the first section, regardless of its ID.
    if (nextOutline[1]?.type !== 'section') return { outline, blockId };
    return {
      outline: removesKey ? clearSpellingDirections(ScoreOttava.reconcile(ScorePedal.reconcile(ScoreTies.reconcile(nextOutline as ScoreProject['outline']))))
        : ScoreOttava.reconcile(ScorePedal.reconcile(ScoreTies.reconcile(nextOutline as ScoreProject['outline']))),
      blockId: nextOutline[index - 1].id,
    };
  }

  export function removeMany(outline: ScoreProject['outline'], blockIds: readonly string[], focusedId: string) {
    const selected = new Set(blockIds);
    selected.delete(outline[0].id);
    let remaining = outline.filter(block => !selected.has(block.id));
    // Keep the required leading section if the selection would expose measures or leave no section.
    if (remaining[1]?.type !== 'section') {
      selected.delete(outline[1].id);
      remaining = outline.filter(block => !selected.has(block.id));
    }
    if (remaining.length === outline.length) return { outline, blockId: focusedId };
    const first = outline.findIndex(block => selected.has(block.id));
    const blockId = outline.slice(0, first).reverse().find(block => !selected.has(block.id))?.id ?? remaining[0].id;
    const reconciled = ScoreOttava.reconcile(ScorePedal.reconcile(ScoreTies.reconcile(remaining as ScoreProject['outline'])));
    return { outline: outline.some(block => selected.has(block.id) && block.type === 'key-change')
      ? clearSpellingDirections(reconciled) : reconciled, blockId };
  }

  export function addMeasure(
    outline: ScoreProject['outline'],
    blockId: string,
  ): { outline: ScoreProject['outline']; blockId: string } {
    const targetIndex = outline.findIndex((block) => block.id === blockId);
    if (targetIndex < 0 || outline[targetIndex].type === 'init') return { outline, blockId };
    const initialValues = outline[0];

    const insertionIndex = targetIndex + 1;

    let measureNumber = 1;
    while (outline.some((block) => block.id === `measure-${measureNumber}`)) {
      measureNumber += 1;
    }

    const previousMeasure = outline
      .slice(0, insertionIndex)
      .reverse()
      .find((block) => block.type === 'measure');
    const length = previousMeasure?.type === 'measure'
      ? previousMeasure.data.length
      : initialValues.data.timeSignature;
    const measure = {
      id: `measure-${measureNumber}`,
      type: 'measure' as const,
      data: ScoreMeasure.create(length),
    };

    const nextOutline = [...outline];
    nextOutline.splice(insertionIndex, 0, measure);

    return {
      outline: ScoreTies.reconcile(nextOutline as ScoreProject['outline']),
      blockId,
    };
  }

  export function addSection(
    outline: ScoreProject['outline'],
    blockId: string,
  ): ScoreProject['outline'] {
    const targetIndex = outline.findIndex((block) => block.id === blockId);
    if (targetIndex < 0) return outline;

    const insertionIndex = targetIndex + 1;

    let sectionNumber = 1;
    while (outline.some((block) => block.id === `section-${sectionNumber}`)) {
      sectionNumber += 1;
    }

    const nextOutline = [...outline];
    nextOutline.splice(insertionIndex, 0, {
      id: `section-${sectionNumber}`,
      type: 'section',
      data: { name: 'section' },
    });

    return nextOutline as ScoreProject['outline'];
  }

  export function renameSection(outline: ScoreProject['outline'], blockId: string, name: string) {
    const block = outline.find(entry => entry.id === blockId);
    const normalized = name.trim();
    if (block?.type !== 'section' || !normalized || normalized === block.data.name) return outline;
    return outline.map(entry => entry.id === block.id
      ? { ...block, data: { ...block.data, name: normalized } } : entry) as ScoreProject['outline'];
  }

}
export default ScoreOutline;
