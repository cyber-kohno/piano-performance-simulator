import type {
  MeasureBlock,
  NoteDuration,
  OutlineBlock,
  PianoNote,
  ScoreProject,
} from '../model/project';

export const TIMELINE_OPERATION_UNITS = [
  { key: '1', value: { cnt: 1, unit: 16 }, stepSixteenths: 1 },
  { key: '2', value: { cnt: 1, unit: 8 }, stepSixteenths: 2 },
  { key: '3', value: { cnt: 1, unit: 4 }, stepSixteenths: 4 },
] as const;
export type TimelineOperationUnit = (typeof TIMELINE_OPERATION_UNITS)[number]['value'];
export const MIN_PIANO_PITCH = 21; // A0
export const MAX_PIANO_PITCH = 108; // C8

export type TimelineCursor = {
  /** Horizontal position measured in sixteenth-note steps from the score start. */
  positionSixteenths: number;
  /** MIDI pitch number. */
  pitch: number;
  /** Duration used by keyboard cursor movement, independent from note duration. */
  operationUnit: TimelineOperationUnit;
  /** Selected note ID; null means the cursor is in note-entry mode. */
  focusedNoteId: string | null;
};

export type LocatedTimelineNote = {
  note: PianoNote;
  measure: MeasureBlock;
  measureStartSixteenths: number;
};

export function createTimelineCursor(): TimelineCursor {
  return {
    positionSixteenths: 0,
    pitch: 60,
    operationUnit: TIMELINE_OPERATION_UNITS[0].value,
    focusedNoteId: null,
  }; // C4, 1/16 operation unit
}

export function getTimelineLengthSixteenths(outline: readonly OutlineBlock[]): number {
  return outline.reduce((total, block) => total + (
    block.type === 'measure'
      ? (block.data.length.cnt / block.data.length.unit) * 16
      : 0
  ), 0);
}

export function getMeasureAtPosition(
  outline: readonly OutlineBlock[],
  positionSixteenths: number,
): { measure: MeasureBlock; startSixteenths: number; lengthSixteenths: number } | undefined {
  let startSixteenths = 0;
  for (const block of outline) {
    if (block.type !== 'measure') continue;

    const lengthSixteenths = (block.data.length.cnt / block.data.length.unit) * 16;
    if (
      positionSixteenths >= startSixteenths &&
      positionSixteenths < startSixteenths + lengthSixteenths
    ) {
      return { measure: block, startSixteenths, lengthSixteenths };
    }
    startSixteenths += lengthSixteenths;
  }
  return undefined;
}

export function getLocatedTimelineNotes(outline: readonly OutlineBlock[]): LocatedTimelineNote[] {
  const located: LocatedTimelineNote[] = [];
  let measureStartSixteenths = 0;

  for (const block of outline) {
    if (block.type !== 'measure') continue;
    for (const note of block.data.upperStaff.voices[0]?.notes ?? []) {
      located.push({ note, measure: block, measureStartSixteenths });
    }
    measureStartSixteenths += (block.data.length.cnt / block.data.length.unit) * 16;
  }

  return located;
}

export function getLocatedTimelineNote(
  outline: readonly OutlineBlock[],
  noteId: string,
): LocatedTimelineNote | undefined {
  return getLocatedTimelineNotes(outline).find(({ note }) => note.id === noteId);
}

export function getOperationStepSixteenths(unit: NoteDuration): number {
  return 16 * unit.cnt / unit.unit;
}

export function getOperationUnitForDuration(duration: NoteDuration): TimelineOperationUnit | undefined {
  return TIMELINE_OPERATION_UNITS.find(({ value }) =>
    value.cnt === duration.cnt && value.unit === duration.unit
  )?.value;
}

export function getOutlinePositionSixteenths(
  outline: readonly OutlineBlock[],
  blockId: string,
): number {
  let position = 0;
  for (const block of outline) {
    if (block.id === blockId) return position;
    if (block.type === 'measure') {
      position += (block.data.length.cnt / block.data.length.unit) * 16;
    }
  }
  return position;
}

export function getOutlineBlockAtPosition(
  outline: readonly OutlineBlock[],
  positionSixteenths: number,
): OutlineBlock | undefined {
  let position = 0;
  let lastSection: OutlineBlock | undefined;

  for (const block of outline) {
    if (block.type === 'section') {
      lastSection = block;
      continue;
    }
    if (block.type !== 'measure') continue;

    const length = (block.data.length.cnt / block.data.length.unit) * 16;
    if (positionSixteenths >= position && positionSixteenths < position + length) {
      return block;
    }
    position += length;
  }

  return lastSection;
}

export function moveTimelineCursorHorizontally(
  cursor: TimelineCursor,
  outline: ScoreProject['outline'],
  direction: -1 | 1,
): TimelineCursor {
  const step = getOperationStepSixteenths(cursor.operationUnit);
  const positionSixteenths = cursor.positionSixteenths + direction * step;
  const totalSteps = getTimelineLengthSixteenths(outline);
  if (positionSixteenths < 0 || positionSixteenths + step > totalSteps + 1e-8) return cursor;
  return { ...cursor, positionSixteenths, focusedNoteId: null };
}

export function setTimelineOperationUnit(
  cursor: TimelineCursor,
  key: string,
): TimelineCursor {
  const selected = TIMELINE_OPERATION_UNITS.find((rate) => rate.key === key);
  if (!selected || selected.value.unit === cursor.operationUnit.unit) return cursor;

  return {
    ...cursor,
    operationUnit: selected.value,
    positionSixteenths: cursor.focusedNoteId === null
      ? Math.floor(cursor.positionSixteenths / selected.stepSixteenths) * selected.stepSixteenths
      : cursor.positionSixteenths,
  };
}

export function isTimelinePlacementInvalid(
  outline: readonly OutlineBlock[],
  cursor: TimelineCursor,
): boolean {
  if (cursor.focusedNoteId !== null) return false;
  const location = getMeasureAtPosition(outline, cursor.positionSixteenths);
  if (!location) return true;

  const localStart = cursor.positionSixteenths - location.startSixteenths;
  const duration = getOperationStepSixteenths(cursor.operationUnit);
  const localEnd = localStart + duration;
  if (localEnd > location.lengthSixteenths + 1e-8) return true;

  return (location.measure.data.upperStaff.voices[0]?.notes ?? []).some((note) => {
    const noteStart = note.positionSixteenths;
    const noteEnd = noteStart + getOperationStepSixteenths(note.duration);
    return localStart < noteEnd - 1e-8 && localEnd > noteStart + 1e-8;
  });
}

export function findTimelineNoteAtMove(
  outline: readonly OutlineBlock[],
  cursor: TimelineCursor,
  direction: -1 | 1,
): LocatedTimelineNote | undefined {
  const step = getOperationStepSixteenths(cursor.operationUnit);
  const start = direction === -1 ? cursor.positionSixteenths - step : cursor.positionSixteenths;
  const end = start + step;
  return getLocatedTimelineNotes(outline).find(({ note, measureStartSixteenths }) => {
    const noteStart = measureStartSixteenths + note.positionSixteenths;
    const noteEnd = noteStart + getOperationStepSixteenths(note.duration);
    return start < noteEnd - 1e-8 && end > noteStart + 1e-8;
  });
}

export function addTimelineNoteAt(
  project: ScoreProject,
  cursor: TimelineCursor,
  positionSixteenths = cursor.positionSixteenths,
  pitch = cursor.pitch,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  const location = getMeasureAtPosition(project.outline, positionSixteenths);
  if (!location) return undefined;

  const durationSixteenths = getOperationStepSixteenths(cursor.operationUnit);
  const positionInMeasure = positionSixteenths - location.startSixteenths;
  if (positionInMeasure + durationSixteenths > location.lengthSixteenths + 1e-8) return undefined;

  const voice = location.measure.data.upperStaff.voices[0];
  if (!voice) return undefined;
  const nextNote = {
    id: createNextNoteId(project.outline),
    positionSixteenths: positionInMeasure,
    duration: { ...cursor.operationUnit },
    pitches: [{ midi: pitch }],
  } satisfies PianoNote;
  const nextLocalEnd = nextNote.positionSixteenths + durationSixteenths;
  const hasOverlap = voice.notes.some((note) => {
    const noteStart = note.positionSixteenths;
    const noteEnd = noteStart + getOperationStepSixteenths(note.duration);
    return nextNote.positionSixteenths < noteEnd - 1e-8 && nextLocalEnd > noteStart + 1e-8;
  });
  if (hasOverlap) return undefined;

  const outline = project.outline.map((block) => {
    if (block.id !== location.measure.id || block.type !== 'measure') return block;
    const voices = block.data.upperStaff.voices.map((currentVoice, index) =>
      index === 0 ? { ...currentVoice, notes: [...currentVoice.notes, nextNote] } : currentVoice,
    );
    return {
      ...block,
      data: { ...block.data, upperStaff: { ...block.data.upperStaff, voices } },
    };
  }) as ScoreProject['outline'];

  return {
    project: { ...project, outline },
    cursor: {
      ...cursor,
      positionSixteenths,
      pitch,
      focusedNoteId: nextNote.id,
    },
  };
}

function createNextNoteId(outline: readonly OutlineBlock[]): string {
  const notes = getLocatedTimelineNotes(outline);
  let number = 1;
  while (notes.some(({ note }) => note.id === `note-${number}`)) number += 1;
  return `note-${number}`;
}

export function moveTimelineCursorPitch(
  cursor: TimelineCursor,
  direction: -1 | 1,
): TimelineCursor {
  const pitch = Math.max(MIN_PIANO_PITCH, Math.min(MAX_PIANO_PITCH, cursor.pitch + direction));
  return pitch === cursor.pitch ? cursor : { ...cursor, pitch };
}

export function moveFocusedTimelineNotePitch(
  project: ScoreProject,
  cursor: TimelineCursor,
  direction: -1 | 1,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null) return undefined;
  const located = getLocatedTimelineNote(project.outline, cursor.focusedNoteId);
  if (!located || located.note.pitches.length === 0) return undefined;

  const selectedPitchIndex = Math.max(
    0,
    located.note.pitches.findIndex((pitch) => pitch.midi === cursor.pitch),
  );
  const selectedPitch = located.note.pitches[selectedPitchIndex];
  const nextMidi = Math.max(
    MIN_PIANO_PITCH,
    Math.min(MAX_PIANO_PITCH, selectedPitch.midi + direction),
  );
  if (nextMidi === selectedPitch.midi) return undefined;

  const outline = project.outline.map((block) => {
    if (block.id !== located.measure.id || block.type !== 'measure') return block;
    const voices = block.data.upperStaff.voices.map((voice, voiceIndex) =>
      voiceIndex === 0
        ? {
            ...voice,
            notes: voice.notes.map((note) => note.id === located.note.id
              ? {
                  ...note,
                  pitches: note.pitches.map((pitch, pitchIndex) =>
                    pitchIndex === selectedPitchIndex ? { ...pitch, midi: nextMidi } : pitch,
                  ),
                }
              : note),
          }
        : voice,
    );
    return {
      ...block,
      data: { ...block.data, upperStaff: { ...block.data.upperStaff, voices } },
    };
  }) as ScoreProject['outline'];

  return {
    project: { ...project, outline },
    cursor: { ...cursor, pitch: nextMidi },
  };
}
