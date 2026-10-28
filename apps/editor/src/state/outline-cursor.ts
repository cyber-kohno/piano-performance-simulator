import {
  createMeasureData, createRestElements, getLocatedVoiceElements, reconcileOutlineTies,
  type KeySignature, type OutlineBlock, type PianoStaff, type ScoreProject,
} from '../model/project.ts';
import { getMeterBeatLength } from './measure-beats.ts';

/** Transient editing state, separate from the saved project data. */
export type OutlineCursor = {
  blockId: string;
};

export function createOutlineCursor(outline: ScoreProject['outline']): OutlineCursor {
  // Like Scorehack, start at the first section after the initial values.
  return { blockId: outline[1].id };
}

// C, G, D, A, E, B, Cb, F#, Gb, C#, Db, Ab, Eb, Bb, F.
const INITIAL_KEY_SIGNATURE_ORDER: readonly KeySignature['fifths'][] = [
  0, 1, 2, 3, 4, 5, -7, 6, -6, 7, -5, -4, -3, -2, -1,
];

export function changeInitialKeySignature(
  outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1,
): ScoreProject['outline'] {
  const initial = outline[0];
  if (cursor.blockId !== initial.id) return outline;
  const index = INITIAL_KEY_SIGNATURE_ORDER.indexOf(initial.data.keySignature.fifths);
  if (index < 0) return outline;
  const fifths = INITIAL_KEY_SIGNATURE_ORDER[
    (index + direction + INITIAL_KEY_SIGNATURE_ORDER.length) % INITIAL_KEY_SIGNATURE_ORDER.length
  ];
  return [{
    ...initial,
    data: { ...initial.data, keySignature: { ...initial.data.keySignature, fifths } },
  }, ...outline.slice(1)] as ScoreProject['outline'];
}

export function changeInitialTempo(
  outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1,
): ScoreProject['outline'] {
  const initial = outline[0];
  if (cursor.blockId !== initial.id) return outline;
  const tempo = Math.max(10, Math.min(400, initial.data.tempo + direction));
  if (tempo === initial.data.tempo) return outline;
  return [{ ...initial, data: { ...initial.data, tempo } }, ...outline.slice(1)] as ScoreProject['outline'];
}

const INITIAL_METER_NUMERATORS = { 4: [2, 3, 4], 8: [3, 6, 9, 12] } as const;

export function changeInitialMeter(
  outline: ScoreProject['outline'], cursor: OutlineCursor, key: string,
): ScoreProject['outline'] {
  const initial = outline[0];
  if (cursor.blockId !== initial.id || outline.some((block) => block.type === 'measure')) return outline;
  const meter = initial.data.timeSignature;
  if (meter.unit !== 4 && meter.unit !== 8) return outline;
  const candidates: readonly number[] = INITIAL_METER_NUMERATORS[meter.unit];
  const index = candidates.indexOf(meter.cnt);
  if (index < 0) return outline;
  let unit: number = meter.unit;
  let cnt = meter.cnt;
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const next = candidates[index + (key === 'ArrowLeft' ? -1 : 1)];
    if (next === undefined) return outline;
    cnt = next;
  } else if (key === 'ArrowUp' && meter.unit === 8) {
    unit = 4;
    cnt = meter.cnt === 3 ? 3 : meter.cnt / 3;
  } else if (key === 'ArrowDown' && meter.unit === 4) {
    unit = 8;
    cnt = meter.cnt * 3;
  } else return outline;
  return [{ ...initial, data: { ...initial.data, timeSignature: { unit, cnt } } }, ...outline.slice(1)] as ScoreProject['outline'];
}

/** Resize one measure by a perceived beat, preserving every note and all unaffected rest spelling. */
export function changeOutlineMeasureBeats(
  outline: ScoreProject['outline'], cursor: OutlineCursor, direction: -1 | 1,
): ScoreProject['outline'] {
  const block = outline.find((entry) => entry.id === cursor.blockId);
  if (!block || block.type !== 'measure') return outline;
  const meter = outline[0].data.timeSignature;
  const beat = getMeterBeatLength(meter);
  const step = beat.cnt / beat.unit * 16;
  const oldLength = block.data.length.cnt / block.data.length.unit * 16;
  const nextLength = oldLength + direction * step;
  const standardLength = meter.cnt / meter.unit * 16;
  if (!Number.isInteger(nextLength) || nextLength < step || nextLength > standardLength) return outline;

  // Check every voice before rebuilding anything; shortening never truncates notes.
  if (direction === -1 && [block.data.upperStaff, block.data.lowerStaff].some((staff) => staff.voices.some((voice) =>
    getLocatedVoiceElements(voice, block.data.length).some((entry) =>
      entry.element.kind === 'note' && entry.positionSixteenths + entry.lengthSixteenths > nextLength,
    ),
  ))) return outline;

  const resizeStaff = (staff: PianoStaff): PianoStaff => ({
    ...staff,
    voices: staff.voices.map((voice) => {
      // A full-measure rest automatically takes the new actual measure length.
      if (voice.elements.length === 1 && voice.elements[0].kind === 'measure-rest') return voice;
      if (direction === 1) return {
        ...voice, elements: [...voice.elements, ...createRestElements(oldLength, nextLength - oldLength)],
      };
      return {
        ...voice,
        elements: getLocatedVoiceElements(voice, block.data.length).flatMap((entry) => {
          if (entry.positionSixteenths >= nextLength) return [];
          if (entry.positionSixteenths + entry.lengthSixteenths <= nextLength) return [entry.element];
          return createRestElements(entry.positionSixteenths, nextLength - entry.positionSixteenths);
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
  return reconcileOutlineTies(next);
}

export function deleteOutlineBlock(
  outline: ScoreProject['outline'],
  cursor: OutlineCursor,
): { outline: ScoreProject['outline']; cursor: OutlineCursor } {
  const index = outline.findIndex((block) => block.id === cursor.blockId);
  if (index < 0 || outline[index].type === 'init') {
    return { outline, cursor };
  }

  const nextOutline = [...outline];
  nextOutline.splice(index, 1);
  // An adjacent section may replace the first section, regardless of its ID.
  if (nextOutline[1]?.type !== 'section') return { outline, cursor };
  return {
    outline: reconcileOutlineTies(nextOutline as ScoreProject['outline']),
    cursor: { blockId: nextOutline[index - 1].id },
  };
}

export function moveOutlineCursor(
  cursor: OutlineCursor,
  outline: readonly OutlineBlock[],
  direction: -1 | 1,
): OutlineCursor {
  const index = outline.findIndex((block) => block.id === cursor.blockId);
  if (index < 0) return cursor;

  const next = outline[index + direction];
  return next ? { blockId: next.id } : cursor;
}

export function moveOutlineSection(
  cursor: OutlineCursor,
  outline: readonly OutlineBlock[],
  direction: -1 | 1,
): OutlineCursor {
  const currentIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (currentIndex < 0) return cursor;

  let nextIndex = currentIndex;
  while (direction < 0 ? nextIndex > 0 : nextIndex < outline.length - 1) {
    nextIndex += direction;
    if (outline[nextIndex].type === 'section' || nextIndex === outline.length - 1) {
      return { blockId: outline[nextIndex].id };
    }
  }

  return cursor;
}

export function addMeasureAfterCursor(
  outline: ScoreProject['outline'],
  cursor: OutlineCursor,
): { outline: ScoreProject['outline']; cursor: OutlineCursor } {
  const cursorIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (cursorIndex < 0 || outline[cursorIndex].type === 'init') return { outline, cursor };
  const initialValues = outline[0];

  const insertionIndex = cursorIndex + 1;

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
    data: createMeasureData(length),
  };

  const nextOutline = [...outline];
  nextOutline.splice(insertionIndex, 0, measure);

  return {
    outline: reconcileOutlineTies(nextOutline as ScoreProject['outline']),
    cursor,
  };
}

export function addSectionAfterCursor(
  outline: ScoreProject['outline'],
  cursor: OutlineCursor,
): ScoreProject['outline'] {
  const cursorIndex = outline.findIndex((block) => block.id === cursor.blockId);
  if (cursorIndex < 0) return outline;

  const insertionIndex = cursorIndex + 1;

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
