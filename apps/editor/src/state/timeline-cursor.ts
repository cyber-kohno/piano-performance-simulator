import {
  createRestElements, createRestId, getLocatedVoiceElements, getNoteValueSixteenths,
  reconcileOutlineTies,
  type KeySignature, type MeasureBlock, type NoteValue, type OutlineBlock, type PianoNote,
  type PianoVoiceElement, type ScoreProject, type TimeSignature,
} from '../model/project.ts';

export const MIN_PIANO_PITCH = 21;
export const MAX_PIANO_PITCH = 108;
export const TIMELINE_CURSOR_UNITS = [
  { key: '1', type: '16th' },
  { key: '2', type: 'eighth' },
  { key: '3', type: 'quarter' },
] as const;

export function getDiatonicPitchClasses(keySignature: KeySignature): Set<number> {
  const naturalPitchClasses = [0, 2, 4, 5, 7, 9, 11];
  const fifths = keySignature.fifths;
  const order = fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
  const altered = new Set(order.slice(0, Math.abs(fifths)));
  return new Set(naturalPitchClasses.map((pitch, step) =>
    (pitch + (altered.has(step) ? Math.sign(fifths) : 0) + 12) % 12,
  ));
}

function findNextPitch(
  pitch: number, direction: -1 | 1, keySignature?: KeySignature,
  occupied: ReadonlySet<number> = new Set(),
): number | undefined {
  const allowed = keySignature ? getDiatonicPitchClasses(keySignature) : undefined;
  for (let midi = pitch + direction; midi >= MIN_PIANO_PITCH && midi <= MAX_PIANO_PITCH; midi += direction) {
    if (!occupied.has(midi) && (!allowed || allowed.has(midi % 12))) return midi;
  }
  return undefined;
}

export type TimelineCursor = {
  /** Editing position only, measured in sixteenths; never persisted on a note. */
  positionSixteenths: number;
  /** Transient movement and new-note value; never rewrites an existing note. */
  placementValue: NoteValue;
  pitch: number;
  focusedNoteId: string | null;
  focusedPitchIndex: number | null;
};
export type LocatedTimelineNote = {
  note: PianoNote;
  measure: MeasureBlock;
  measureStartSixteenths: number;
  /** Derived by summing preceding voice elements, not saved on the note. */
  positionSixteenths: number;
};
export function createTimelineCursor(): TimelineCursor {
  return { positionSixteenths: 0, placementValue: { type: '16th', dots: 0 }, pitch: 60, focusedNoteId: null, focusedPitchIndex: null };
}
export function setTimelineCursorUnit(cursor: TimelineCursor, key: string): TimelineCursor {
  const unit = TIMELINE_CURSOR_UNITS.find((unit) => unit.key === key);
  if (!unit || (cursor.placementValue.type === unit.type && cursor.placementValue.dots === 0)) return cursor;
  return { ...cursor, placementValue: { type: unit.type, dots: 0 } };
}
export function getTimelineLengthSixteenths(outline: readonly OutlineBlock[]): number {
  return outline.reduce((sum, block) => sum + (block.type === 'measure' ? block.data.length.cnt / block.data.length.unit * 16 : 0), 0);
}
export function getMeasureAtPosition(outline: readonly OutlineBlock[], position: number) {
  let startSixteenths = 0;
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    const lengthSixteenths = block.data.length.cnt / block.data.length.unit * 16;
    if (position >= startSixteenths && position < startSixteenths + lengthSixteenths) {
      return { measure: block, startSixteenths, lengthSixteenths };
    }
    startSixteenths += lengthSixteenths;
  }
  return undefined;
}
export function getLocatedTimelineNotes(outline: readonly OutlineBlock[]): LocatedTimelineNote[] {
  const notes: LocatedTimelineNote[] = [];
  let measureStartSixteenths = 0;
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    const voice = block.data.upperStaff.voices[0];
    if (voice) for (const entry of getLocatedVoiceElements(voice, block.data.length)) {
      if (entry.element.kind === 'note') notes.push({
        note: entry.element, measure: block, measureStartSixteenths,
        positionSixteenths: entry.positionSixteenths,
      });
    }
    measureStartSixteenths += block.data.length.cnt / block.data.length.unit * 16;
  }
  return notes;
}
export function getLocatedTimelineNote(outline: readonly OutlineBlock[], noteId: string) {
  return getLocatedTimelineNotes(outline).find(({ note }) => note.id === noteId);
}

export function getTimelineTieChain(outline: readonly OutlineBlock[], noteId: string): LocatedTimelineNote[] {
  const byId = new Map(getLocatedTimelineNotes(outline).map((entry) => [entry.note.id, entry]));
  let head = byId.get(noteId);
  if (!head) return [];
  const visited = new Set([head.note.id]);
  while (head.note.tieFrom) {
    const previous = byId.get(head.note.tieFrom);
    if (!previous || previous.note.tieTo !== head.note.id || visited.has(previous.note.id)) break;
    visited.add(previous.note.id);
    head = previous;
  }
  const result: LocatedTimelineNote[] = [];
  visited.clear();
  let current: LocatedTimelineNote | undefined = head;
  while (current && !visited.has(current.note.id)) {
    result.push(current);
    visited.add(current.note.id);
    const next: LocatedTimelineNote | undefined = current.note.tieTo ? byId.get(current.note.tieTo) : undefined;
    current = next?.note.tieFrom === current.note.id ? next : undefined;
  }
  return result;
}

export function getOutlinePositionSixteenths(outline: readonly OutlineBlock[], blockId: string): number {
  let position = 0;
  for (const block of outline) {
    if (block.id === blockId) return position;
    if (block.type === 'measure') position += block.data.length.cnt / block.data.length.unit * 16;
  }
  return position;
}
export function getOutlineBlockAtPosition(outline: readonly OutlineBlock[], position: number): OutlineBlock | undefined {
  let start = 0;
  let lastSection: OutlineBlock | undefined;
  for (const block of outline) {
    if (block.type === 'section') { lastSection = block; continue; }
    if (block.type !== 'measure') continue;
    const length = block.data.length.cnt / block.data.length.unit * 16;
    if (position >= start && position < start + length) return block;
    start += length;
  }
  return lastSection;
}
export function moveTimelineCursorHorizontally(cursor: TimelineCursor, outline: ScoreProject['outline'], direction: -1 | 1): TimelineCursor {
  const step = getNoteValueSixteenths(cursor.placementValue);
  const position = cursor.positionSixteenths + direction * step;
  if (position < 0 || position + step > getTimelineLengthSixteenths(outline)) return cursor;
  return { ...cursor, positionSixteenths: position, focusedNoteId: null, focusedPitchIndex: null };
}
export function focusAdjacentTimelineNote(outline: readonly OutlineBlock[], cursor: TimelineCursor, direction: -1 | 1): TimelineCursor {
  const onset = (entry: LocatedTimelineNote) => entry.measureStartSixteenths + entry.positionSixteenths;
  const notes = getLocatedTimelineNotes(outline).filter(({ note }) => note.pitches.length > 0).sort((a, b) => onset(a) - onset(b));
  let target: LocatedTimelineNote | undefined;
  if (cursor.focusedNoteId !== null) {
    const index = notes.findIndex(({ note }) => note.id === cursor.focusedNoteId);
    if (index < 0) return cursor;
    target = notes[index + direction];
  } else {
    target = (direction < 0 ? [...notes].reverse() : notes).find((entry) => direction < 0
      ? cursor.positionSixteenths > onset(entry)
      : cursor.positionSixteenths < onset(entry) + getNoteValueSixteenths(entry.note.value));
  }
  return target ? {
    ...cursor, positionSixteenths: onset(target), pitch: target.note.pitches[0].midi,
    focusedNoteId: target.note.id, focusedPitchIndex: 0,
  } : cursor;
}
export function findTimelineNoteAtMove(outline: readonly OutlineBlock[], cursor: TimelineCursor, direction: -1 | 1) {
  const step = getNoteValueSixteenths(cursor.placementValue);
  const start = direction < 0 ? cursor.positionSixteenths - step : cursor.positionSixteenths;
  const end = start + step;
  return getLocatedTimelineNotes(outline).find((entry) => {
    const onset = entry.measureStartSixteenths + entry.positionSixteenths;
    return start < onset + getNoteValueSixteenths(entry.note.value) && end > onset;
  });
}

function getPlacementRest(outline: readonly OutlineBlock[], position: number, value: NoteValue) {
  if (!Number.isInteger(position) || position < 0) return undefined;
  const length = getNoteValueSixteenths(value);
  if (!Number.isInteger(length) || length < 1) return undefined;
  const location = getMeasureAtPosition(outline, position);
  if (!location) return undefined;
  const local = position - location.startSixteenths;
  if (local + length > location.lengthSixteenths) return undefined;
  const voice = location.measure.data.upperStaff.voices[0];
  if (!voice) return undefined;
  const entries = getLocatedVoiceElements(voice, location.measure.data.length).filter((entry) =>
    entry.positionSixteenths < local + length && entry.positionSixteenths + entry.lengthSixteenths > local,
  );
  if (!entries.length || entries.some(({ element }) => element.kind === 'note')) return undefined;
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (first.positionSixteenths > local || last.positionSixteenths + last.lengthSixteenths < local + length) return undefined;
  return { location, voice, first, last, local, length };
}
export function isTimelinePlacementInvalid(outline: readonly OutlineBlock[], cursor: TimelineCursor): boolean {
  return cursor.focusedNoteId === null && !getPlacementRest(outline, cursor.positionSixteenths, cursor.placementValue);
}

export function addTimelineNoteAt(
  project: ScoreProject, cursor: TimelineCursor,
  position = cursor.positionSixteenths, pitch = cursor.pitch,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  const target = getPlacementRest(project.outline, position, cursor.placementValue);
  if (!target || !Number.isInteger(pitch) || pitch < MIN_PIANO_PITCH || pitch > MAX_PIANO_PITCH) return undefined;
  const { location, voice, first, last, local, length } = target;
  const usedIds = new Set(project.outline.flatMap((block) => block.type !== 'measure' ? [] :
    [block.data.upperStaff, block.data.lowerStaff].flatMap((staff) => staff.voices.flatMap((voice) => voice.elements.map((element) => element.id))),
  ));
  let number = 1;
  while (usedIds.has(`note-${number}`)) number += 1;
  const note: PianoNote = { id: `note-${number}`, kind: 'note', value: { ...cursor.placementValue }, pitches: [{ midi: pitch }] };
  const elements = [
    ...voice.elements.slice(0, first.index),
    ...createRestElements(first.positionSixteenths, local - first.positionSixteenths),
    note,
    ...createRestElements(local + length, last.positionSixteenths + last.lengthSixteenths - local - length),
    ...voice.elements.slice(last.index + 1),
  ];
  const outline = project.outline.map((block) => block.id !== location.measure.id || block.type !== 'measure' ? block : {
    ...block, data: { ...block.data, upperStaff: {
      ...block.data.upperStaff,
      voices: block.data.upperStaff.voices.map((voice, index) => index !== 0 ? voice : { ...voice, elements }),
    } },
  }) as ScoreProject['outline'];
  return {
    project: { ...project, outline },
    cursor: { ...cursor, positionSixteenths: position, pitch, focusedNoteId: note.id, focusedPitchIndex: 0 },
  };
}

/** Explicitly append one written segment; never overwrite an existing tie successor. */
export function appendFocusedTimelineTie(
  project: ScoreProject, cursor: TimelineCursor,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null) return undefined;
  const selected = getLocatedTimelineNote(project.outline, cursor.focusedNoteId);
  if (!selected || selected.note.tieTo || selected.note.pitches.length === 0) return undefined;
  const pitchIndex = cursor.focusedPitchIndex !== null && selected.note.pitches[cursor.focusedPitchIndex]
    ? cursor.focusedPitchIndex : 0;
  const end = selected.measureStartSixteenths + selected.positionSixteenths + getNoteValueSixteenths(selected.note.value);
  const result = addTimelineNoteAt(project, cursor, end, selected.note.pitches[pitchIndex].midi);
  if (!result) return undefined;
  const nextId = result.cursor.focusedNoteId!;
  const nextProject = mapTimelineNotes(result.project, new Set([selected.note.id, nextId]), (note) =>
    note.id === selected.note.id
      ? { ...note, tieTo: nextId }
      : { ...note, tieFrom: selected.note.id, pitches: selected.note.pitches.map((pitch) => ({ ...pitch })) },
  );
  return {
    project: nextProject,
    cursor: { ...result.cursor, focusedPitchIndex: pitchIndex },
  };
}

type TimelineNotePlan = { measureId: string; position: number; note: PianoNote };

/** Callers validate that this continuous span contains no unrelated notes. */
function rewriteTimelineNoteSpan(project: ScoreProject, start: number, end: number, plans: TimelineNotePlan[]): ScoreProject {
  let measureStart = 0;
  const outline = project.outline.map((block) => {
    if (block.type !== 'measure') return block;
    const measureLength = block.data.length.cnt / block.data.length.unit * 16;
    const localStart = Math.max(0, start - measureStart);
    const localEnd = Math.min(measureLength, end - measureStart);
    measureStart += measureLength;
    if (localStart >= localEnd) return block;
    const voice = block.data.upperStaff.voices[0];
    const entries = getLocatedVoiceElements(voice, block.data.length).filter((entry) =>
      entry.positionSixteenths < localEnd && entry.positionSixteenths + entry.lengthSixteenths > localStart,
    );
    const first = entries[0];
    const last = entries[entries.length - 1];
    const replacements: PianoVoiceElement[] = [];
    let position = first.positionSixteenths;
    for (const plan of plans.filter((plan) => plan.measureId === block.id)) {
      replacements.push(...createRestElements(position, plan.position - position), plan.note);
      position = plan.position + getNoteValueSixteenths(plan.note.value);
    }
    replacements.push(...createRestElements(position, last.positionSixteenths + last.lengthSixteenths - position));
    const elements = [...voice.elements.slice(0, first.index), ...replacements, ...voice.elements.slice(last.index + 1)];
    return { ...block, data: { ...block.data, upperStaff: {
      ...block.data.upperStaff,
      voices: block.data.upperStaff.voices.map((voice, index) => index !== 0 ? voice : { ...voice, elements }),
    } } };
  }) as ScoreProject['outline'];
  return { ...project, outline };
}

/** Edit one written value and move only its tied successors, adjusting surrounding rests. */
export function setFocusedTimelineNoteValue(
  project: ScoreProject, cursor: TimelineCursor, value: NoteValue,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null || !Number.isInteger(value.dots) || value.dots < 0) return undefined;
  const length = getNoteValueSixteenths(value);
  // The current editing grid cannot represent a dotted sixteenth's endpoint.
  if (!Number.isInteger(length) || length < 1) return undefined;
  const chain = getTimelineTieChain(project.outline, cursor.focusedNoteId);
  const index = chain.findIndex(({ note }) => note.id === cursor.focusedNoteId);
  if (index < 0) return undefined;
  const selected = chain[index];
  if (selected.note.value.type === value.type && selected.note.value.dots === value.dots) return undefined;
  const suffix = chain.slice(index);
  const start = selected.measureStartSixteenths + selected.positionSixteenths;
  const tail = suffix[suffix.length - 1];
  const oldEnd = tail.measureStartSixteenths + tail.positionSixteenths + getNoteValueSixteenths(tail.note.value);
  const plans: TimelineNotePlan[] = [];
  let nextStart = start;
  for (const entry of suffix) {
    const nextValue = entry.note.id === selected.note.id ? value : entry.note.value;
    const nextLength = getNoteValueSixteenths(nextValue);
    const location = getMeasureAtPosition(project.outline, nextStart);
    if (!location || !location.measure.data.upperStaff.voices[0]) return undefined;
    const position = nextStart - location.startSixteenths;
    // Explicit note values are never split automatically at a barline.
    if (position + nextLength > location.lengthSixteenths) return undefined;
    plans.push({ measureId: location.measure.id, position, note: { ...entry.note, value: { ...nextValue } } });
    nextStart += nextLength;
  }
  const affectedIds = new Set(suffix.map(({ note }) => note.id));
  const end = Math.max(oldEnd, nextStart);
  if (getLocatedTimelineNotes(project.outline).some((entry) => {
    if (affectedIds.has(entry.note.id)) return false;
    const onset = entry.measureStartSixteenths + entry.positionSixteenths;
    return onset < end && onset + getNoteValueSixteenths(entry.note.value) > start;
  })) return undefined;

  return {
    project: rewriteTimelineNoteSpan(project, start, end, plans),
    cursor: { ...cursor, positionSixteenths: start },
  };
}

/** Spelling policy used only by F+arrows, never by ordinary notation edits. */
function normalizeResizedNoteValues(position: number, length: number, meter: TimeSignature): NoteValue[] | undefined {
  const values: NoteValue[] = [
    { type: 'whole', dots: 0 }, { type: 'half', dots: 1 }, { type: 'half', dots: 0 },
    { type: 'quarter', dots: 1 }, { type: 'quarter', dots: 0 }, { type: 'eighth', dots: 1 },
    { type: 'eighth', dots: 0 }, { type: '16th', dots: 0 },
  ];
  const compound = meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0;
  const beat = compound ? 6 : 16 / meter.unit;
  const aligned = (at: number, unit: number) => Math.abs(at / unit - Math.round(at / unit)) < 1e-8;
  const memo = new Map<number, NoteValue[]>();
  const solve = (remaining: number): NoteValue[] => {
    if (remaining === 0) return [];
    const cached = memo.get(remaining);
    if (cached) return cached;
    let best: NoteValue[] | undefined;
    const at = position + length - remaining;
    const beatOffset = at - Math.floor(at / beat + 1e-8) * beat;
    const nextBeat = (Math.floor(at / beat + 1e-8) + 1) * beat;
    for (const value of values) {
      const steps = getNoteValueSixteenths(value);
      if (steps > remaining) continue;
      const base = getNoteValueSixteenths({ ...value, dots: 0 });
      // Sub-beat values align inside the beat; dotted compound beats align to their group.
      const basePosition = compound && base < beat ? beatOffset : at;
      const compoundBeatValue = compound && aligned(steps, beat) && aligned(at, steps);
      if (!aligned(basePosition, base) && !compoundBeatValue) continue;
      // An offbeat prefix ends at the next beat before a larger value can begin.
      if (!aligned(at, beat) && at + steps > nextBeat + 1e-8) continue;
      if (compound && steps > beat && !aligned(steps, beat)) continue;
      const candidate = [value, ...solve(remaining - steps)];
      // Fewest segments; prefer an undotted prefix on ties (7 = quarter + dotted eighth).
      if (!best || candidate.length < best.length ||
        (candidate.length === best.length && value.dots === 0 && best[0].dots !== 0)) best = candidate;
    }
    memo.set(remaining, best!);
    return best!;
  };
  return Number.isInteger(length) && length > 0 ? solve(length) : undefined;
}

export function resizeFocusedTimelineTie(
  project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null) return undefined;
  const chain = getTimelineTieChain(project.outline, cursor.focusedNoteId);
  if (!chain.length) return undefined;
  const first = chain[0];
  const last = chain[chain.length - 1];
  const start = first.measureStartSixteenths + first.positionSixteenths;
  const oldEnd = last.measureStartSixteenths + last.positionSixteenths + getNoteValueSixteenths(last.note.value);
  const step = getNoteValueSixteenths(cursor.placementValue);
  const newEnd = oldEnd + direction * step;
  const limit = getTimelineLengthSixteenths(project.outline);
  if (!Number.isInteger(step) || step < 1 || newEnd <= start || newEnd > limit) return undefined;
  const samePitchNames = (a: PianoNote['pitches'], b: PianoNote['pitches']) =>
    a.length === b.length && a.every((pitch, index) => pitch.midi === b[index].midi);
  const samePitches = (a: PianoNote['pitches'], b: PianoNote['pitches']) =>
    samePitchNames(a, b) && a.every((pitch, index) => pitch.fingering === b[index].fingering);
  let expected = start;
  for (const entry of chain) {
    const length = getNoteValueSixteenths(entry.note.value);
    if (!entry.note.pitches.length || !Number.isInteger(length) || length < 1 ||
      entry.measureStartSixteenths + entry.positionSixteenths !== expected ||
      !samePitchNames(first.note.pitches, entry.note.pitches)) return undefined;
    expected += length;
  }
  const ids = new Set(chain.map(({ note }) => note.id));
  if (getLocatedTimelineNotes(project.outline).some((entry) => {
    const onset = entry.measureStartSixteenths + entry.positionSixteenths;
    return !ids.has(entry.note.id) && onset < newEnd && onset + getNoteValueSixteenths(entry.note.value) > start;
  })) return undefined;

  // Preserve finger changes as boundaries that normalization cannot merge across.
  const groups: { start: number; pitches: PianoNote['pitches'] }[] = [];
  for (const entry of chain) {
    if (!groups.length || !samePitches(groups[groups.length - 1].pitches, entry.note.pitches)) {
      groups.push({ start: entry.measureStartSixteenths + entry.positionSixteenths, pitches: entry.note.pitches });
    }
  }
  const usedIds = new Set(project.outline.flatMap((block) => block.type !== 'measure' ? [] :
    [block.data.upperStaff, block.data.lowerStaff].flatMap((staff) => staff.voices.flatMap((voice) => voice.elements.map((element) => element.id))),
  ));
  let number = 1;
  const plans: (TimelineNotePlan & { onset: number })[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const end = Math.min(newEnd, groups[index + 1]?.start ?? newEnd);
    let onset = group.start;
    while (onset < end) {
      const location = getMeasureAtPosition(project.outline, onset);
      if (!location || !location.measure.data.upperStaff.voices[0]) return undefined;
      const stop = Math.min(end, location.startSixteenths + location.lengthSixteenths);
      const values = normalizeResizedNoteValues(onset - location.startSixteenths, stop - onset, project.outline[0].data.timeSignature);
      if (!values) return undefined;
      for (const value of values) {
        const previous = chain.find((entry) => entry.measureStartSixteenths + entry.positionSixteenths === onset && samePitches(entry.note.pitches, group.pitches));
        while (usedIds.has(`note-${number}`)) number += 1;
        const id = previous?.note.id ?? `note-${number++}`;
        usedIds.add(id);
        plans.push({
          measureId: location.measure.id, position: onset - location.startSixteenths, onset,
          note: { id, kind: 'note', value: { ...value }, pitches: group.pitches.map((pitch) => ({ ...pitch })) },
        });
        onset += getNoteValueSixteenths(value);
      }
    }
  }
  plans.forEach((plan, index) => {
    if (index > 0) plan.note.tieFrom = plans[index - 1].note.id;
    if (index + 1 < plans.length) plan.note.tieTo = plans[index + 1].note.id;
  });
  const tail = plans[plans.length - 1];
  const pitchIndex = cursor.focusedPitchIndex !== null && tail.note.pitches[cursor.focusedPitchIndex]
    ? cursor.focusedPitchIndex : 0;
  return {
    project: rewriteTimelineNoteSpan(project, start, Math.max(oldEnd, newEnd), plans),
    cursor: { ...cursor, positionSixteenths: tail.onset, focusedNoteId: tail.note.id,
      focusedPitchIndex: pitchIndex, pitch: tail.note.pitches[pitchIndex].midi },
  };
}

export function setFocusedTimelineNoteType(project: ScoreProject, cursor: TimelineCursor, key: string) {
  const unit = TIMELINE_CURSOR_UNITS.find((unit) => unit.key === key);
  const selected = cursor.focusedNoteId ? getLocatedTimelineNote(project.outline, cursor.focusedNoteId) : undefined;
  return unit && selected
    ? setFocusedTimelineNoteValue(project, cursor, { ...selected.note.value, type: unit.type })
    : undefined;
}

export function toggleFocusedTimelineNoteDot(project: ScoreProject, cursor: TimelineCursor) {
  const selected = cursor.focusedNoteId ? getLocatedTimelineNote(project.outline, cursor.focusedNoteId) : undefined;
  return selected ? setFocusedTimelineNoteValue(project, cursor, {
    ...selected.note.value, dots: selected.note.value.dots > 0 ? 0 : 1,
  }) : undefined;
}

/** Move a sustained note/chord without changing its explicit spelling or jumping its selection. */
export function moveFocusedTimelineNote(
  project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null) return undefined;
  const chain = getTimelineTieChain(project.outline, cursor.focusedNoteId);
  if (!chain.length) return undefined;
  const shift = direction * getNoteValueSixteenths(cursor.placementValue);
  if (!Number.isInteger(shift) || shift === 0) return undefined;
  const ids = new Set(chain.map(({ note }) => note.id));
  const plans: { measureId: string; position: number; onset: number; note: PianoNote }[] = [];
  const others = getLocatedTimelineNotes(project.outline).filter(({ note }) => !ids.has(note.id));
  for (const entry of chain) {
    const onset = entry.measureStartSixteenths + entry.positionSixteenths + shift;
    const length = getNoteValueSixteenths(entry.note.value);
    const location = getMeasureAtPosition(project.outline, onset);
    if (!location || !location.measure.data.upperStaff.voices[0]) return undefined;
    const position = onset - location.startSixteenths;
    if (!Number.isInteger(length) || position + length > location.lengthSixteenths) return undefined;
    if (others.some((other) => {
      const otherStart = other.measureStartSixteenths + other.positionSixteenths;
      return onset < otherStart + getNoteValueSixteenths(other.note.value) && onset + length > otherStart;
    })) return undefined;
    plans.push({ measureId: location.measure.id, position, onset, note: entry.note });
  }

  const outline = project.outline.map((block) => {
    if (block.type !== 'measure') return block;
    const voice = block.data.upperStaff.voices[0];
    if (!voice) return block;
    const entries = getLocatedVoiceElements(voice, block.data.length);
    const incoming = plans.filter((plan) => plan.measureId === block.id);
    const ranges = entries.filter(({ element }) => ids.has(element.id)).map(({ index }) => ({ first: index, last: index }));
    for (const plan of incoming) {
      const end = plan.position + getNoteValueSixteenths(plan.note.value);
      const hit = entries.filter((entry) => entry.positionSixteenths < end && entry.positionSixteenths + entry.lengthSixteenths > plan.position);
      ranges.push({ first: hit[0].index, last: hit[hit.length - 1].index });
    }
    if (!ranges.length) return block;
    ranges.sort((a, b) => a.first - b.first);
    const merged: typeof ranges = [];
    for (const range of ranges) {
      const previous = merged[merged.length - 1];
      if (previous && range.first <= previous.last + 1) previous.last = Math.max(previous.last, range.last);
      else merged.push({ ...range });
    }
    const elements: PianoVoiceElement[] = [];
    let nextIndex = 0;
    for (const range of merged) {
      elements.push(...voice.elements.slice(nextIndex, range.first));
      const first = entries[range.first];
      const last = entries[range.last];
      const start = first.positionSixteenths;
      const end = last.positionSixteenths + last.lengthSixteenths;
      const notes = incoming.filter((plan) => plan.position >= start && plan.position < end)
        .map((plan) => ({ position: plan.position, note: plan.note }));
      for (const entry of entries.slice(range.first, range.last + 1)) {
        if (entry.element.kind === 'note' && !ids.has(entry.element.id)) notes.push({ position: entry.positionSixteenths, note: entry.element });
      }
      notes.sort((a, b) => a.position - b.position);
      let position = start;
      for (const entry of notes) {
        elements.push(...createRestElements(position, entry.position - position), entry.note);
        position = entry.position + getNoteValueSixteenths(entry.note.value);
      }
      elements.push(...createRestElements(position, end - position));
      nextIndex = range.last + 1;
    }
    elements.push(...voice.elements.slice(nextIndex));
    return { ...block, data: { ...block.data, upperStaff: {
      ...block.data.upperStaff,
      voices: block.data.upperStaff.voices.map((voice, index) => index !== 0 ? voice : { ...voice, elements }),
    } } };
  }) as ScoreProject['outline'];
  const selected = plans.find(({ note }) => note.id === cursor.focusedNoteId)!;
  return {
    project: { ...project, outline },
    cursor: { ...cursor, positionSixteenths: selected.onset },
  };
}

function mapTimelineNotes(project: ScoreProject, ids: ReadonlySet<string>, update: (note: PianoNote) => PianoVoiceElement): ScoreProject {
  return { ...project, outline: project.outline.map((block) => block.type !== 'measure' ? block : {
    ...block, data: { ...block.data, upperStaff: {
      ...block.data.upperStaff,
      voices: block.data.upperStaff.voices.map((voice, index) => index !== 0 ? voice : {
        ...voice, elements: voice.elements.map((element) => element.kind === 'note' && ids.has(element.id) ? update(element) : element),
      }),
    } },
  }) as ScoreProject['outline'] };
}

export function moveTimelineCursorPitch(cursor: TimelineCursor, direction: -1 | 1, keySignature?: KeySignature): TimelineCursor {
  const pitch = findNextPitch(cursor.pitch, direction, keySignature);
  return pitch === undefined ? cursor : { ...cursor, pitch };
}
export function moveFocusedTimelineNotePitch(
  project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1, keySignature?: KeySignature,
): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null || cursor.focusedPitchIndex === null) return undefined;
  const located = getLocatedTimelineNote(project.outline, cursor.focusedNoteId);
  const selected = located?.note.pitches[cursor.focusedPitchIndex];
  if (!located || !selected) return undefined;
  const midi = findNextPitch(selected.midi, direction, keySignature, new Set(located.note.pitches.map((pitch) => pitch.midi)));
  if (midi === undefined) return undefined;
  const ids = new Set(getTimelineTieChain(project.outline, located.note.id).map(({ note }) => note.id));
  const nextProject = mapTimelineNotes(project, ids, (note) => ({
    ...note, pitches: note.pitches.map((pitch, index) => index === cursor.focusedPitchIndex ? { ...pitch, midi } : pitch).sort((a, b) => b.midi - a.midi),
  }));
  return {
    project: nextProject,
    cursor: { ...cursor, pitch: midi, focusedPitchIndex: located.note.pitches.filter((pitch, index) => index !== cursor.focusedPitchIndex && pitch.midi > midi).length },
  };
}
export function selectFocusedNotePitch(project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1): TimelineCursor {
  if (cursor.focusedNoteId === null || cursor.focusedPitchIndex === null) return cursor;
  const index = cursor.focusedPitchIndex - direction;
  const pitch = getLocatedTimelineNote(project.outline, cursor.focusedNoteId)?.note.pitches[index];
  return pitch ? { ...cursor, focusedPitchIndex: index, pitch: pitch.midi } : cursor;
}
export function addFocusedNotePitch(project: ScoreProject, cursor: TimelineCursor): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null || cursor.focusedPitchIndex === null) return undefined;
  const located = getLocatedTimelineNote(project.outline, cursor.focusedNoteId);
  const selected = located?.note.pitches[cursor.focusedPitchIndex];
  if (!located || !selected) return undefined;
  const midi = selected.midi - 1;
  if (midi < MIN_PIANO_PITCH || located.note.pitches.some((pitch) => pitch.midi === midi)) return undefined;
  const pitches = [...located.note.pitches, { midi }].sort((a, b) => b.midi - a.midi);
  const ids = new Set(getTimelineTieChain(project.outline, located.note.id).map(({ note }) => note.id));
  return {
    project: mapTimelineNotes(project, ids, (note) => ({ ...note, pitches: [...note.pitches, { midi }].sort((a, b) => b.midi - a.midi) })),
    cursor: { ...cursor, pitch: midi, focusedPitchIndex: pitches.findIndex((pitch) => pitch.midi === midi) },
  };
}
export function deleteFocusedTimelineNote(project: ScoreProject, cursor: TimelineCursor, pitchOnly = false): { project: ScoreProject; cursor: TimelineCursor } | undefined {
  if (cursor.focusedNoteId === null) return undefined;
  const located = getLocatedTimelineNote(project.outline, cursor.focusedNoteId);
  if (!located) return undefined;
  const index = cursor.focusedPitchIndex;
  if (pitchOnly && (index === null || !located.note.pitches[index])) return undefined;
  const pitches = pitchOnly ? located.note.pitches.filter((_, pitchIndex) => pitchIndex !== index) : [];
  const targets = pitchOnly
    ? new Set(getTimelineTieChain(project.outline, located.note.id).map(({ note }) => note.id))
    : new Set([located.note.id]);
  const nextProject = mapTimelineNotes(project, targets, (note) => pitches.length === 0
    ? { id: createRestId(), kind: 'rest', value: { ...note.value } }
    : { ...note, pitches: note.pitches.filter((_, pitchIndex) => pitchIndex !== index) });
  const nextIndex = Math.min(index ?? 0, pitches.length - 1);
  return {
    project: { ...nextProject, outline: reconcileOutlineTies(nextProject.outline) },
    cursor: pitches.length > 0
      ? { ...cursor, focusedPitchIndex: nextIndex, pitch: pitches[nextIndex].midi }
      : { ...cursor, positionSixteenths: located.measureStartSixteenths + located.positionSixteenths, focusedNoteId: null, focusedPitchIndex: null },
  };
}
