import { createRestElements, createRestId, getFlattenedVoiceElements, getLocatedVoiceElements, getNoteValueSixteenths, isOnEditingGrid, reconcileOutlineTies, type NoteValue, type OutlineBlock, type PianoNote, type PianoRest, type PianoTuplet, type PianoVoiceElement, type ScoreProject } from '../model/project.ts';
import { addTime, compareTime, fromNumber, multiply, rational, toNumber } from '../model/rational.ts';
import { hasCrossVoicePitchCollision } from '../model/pitch-collision.ts';
import type { TimelineCursor } from './timeline-cursor.ts';

export function getTupletContexts(outline: readonly OutlineBlock[], cursor: TimelineCursor) {
  const contexts = [];
  let measureStart = 0;
  for (const measure of outline) {
    if (measure.type !== 'measure') continue;
    const start = measureStart;
    measureStart += measure.data.length.cnt / measure.data.length.unit * 16;
    const voice = measure.data[cursor.staff].voices[cursor.voiceIndex];
    if (!voice) continue;
    for (const entry of getLocatedVoiceElements(voice, measure.data.length)) {
      if (entry.element.kind !== 'tuplet') continue;
      const group = entry.element;
      const groupStart = addTime(start, entry.positionSixteenths);
      const groupEnd = addTime(groupStart, entry.lengthSixteenths);
      contexts.push({ measure, measureStart: start, voice, entry, group, start: groupStart, end: groupEnd,
        base: getNoteValueSixteenths({ type: group.baseType, dots: 0 }),
        step: getNoteValueSixteenths({ type: group.baseType, dots: 0 }) * group.normal / group.actual });
    }
  }
  return contexts;
}
export function getTupletContext(outline: readonly OutlineBlock[], cursor: TimelineCursor, position = cursor.positionSixteenths, useFocus = true) {
  return getTupletContexts(outline, cursor).find((context) => useFocus && cursor.focusedNoteId !== null
    ? context.group.elements.some((child) => child.id === cursor.focusedNoteId)
    : compareTime(position, context.start) >= 0 && compareTime(position, context.end) < 0);
}
type Context = NonNullable<ReturnType<typeof getTupletContext>>;
function writtenNotes(context: Context) {
  let position = 0;
  return context.group.elements.flatMap((element) => {
    const start = position;
    position += getNoteValueSixteenths(element.value);
    return element.kind === 'note' ? [{ note: element, start, length: position - start }] : [];
  });
}
function writeGroup(context: Context, notes: ReturnType<typeof writtenNotes>): PianoTuplet | undefined {
  notes.sort((a, b) => a.start - b.start);
  const previous = writtenNotes(context);
  const changed = notes.flatMap((entry) => {
    const old = previous.find(({ note }) => note.id === entry.note.id);
    return old && old.start === entry.start && old.length === entry.length ? []
      : [entry, ...(old ? [old] : [])];
  });
  let oldPosition = 0;
  const preservedRests = context.group.elements.flatMap((element) => {
    const start = oldPosition;
    oldPosition += getNoteValueSixteenths(element.value);
    return element.kind === 'rest' && !changed.some((entry) => entry.start < oldPosition && entry.start + entry.length > start)
      ? [{ note: element, start, length: oldPosition - start }] : [];
  });
  let position = 0;
  const elements: (PianoNote | PianoRest)[] = [];
  for (const entry of [...notes, ...preservedRests].sort((a, b) => a.start - b.start)) {
    if (entry.start < position || entry.start + entry.length > context.base * context.group.actual) return undefined;
    elements.push(...createRestElements(position, entry.start - position), entry.note);
    position = entry.start + entry.length;
  }
  elements.push(...createRestElements(position, context.base * context.group.actual - position));
  return { ...context.group, elements };
}
function commit(project: ScoreProject, cursor: TimelineCursor, context: Context, element: PianoNote | PianoTuplet, position = cursor.positionSixteenths, editedIds?: ReadonlySet<string>) {
  const outline = project.outline.map((block) => block !== context.measure ? block : {
    ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff], voices: block.data[cursor.staff].voices.map((voice, index) => index !== cursor.voiceIndex ? voice : {
      ...voice, elements: voice.elements.map((old) => old.id === context.group.id ? element : old),
    }) } },
  }) as ScoreProject['outline'];
  const changedIds = editedIds ?? new Set(element.kind === 'note' ? [element.id] : element.elements.filter((child) => child.kind === 'note').map((child) => child.id));
  const changedVoice = outline.find((block) => block.id === context.measure.id);
  if (changedVoice?.type !== 'measure') return undefined;
  const spans = getFlattenedVoiceElements(changedVoice.data[cursor.staff].voices[cursor.voiceIndex], changedVoice.data.length)
    .filter(({ element }) => changedIds.has(element.id)).map((entry) => ({ staff: cursor.staff, voiceId: context.voice.id,
      startSixteenths: addTime(context.measureStart, entry.positionSixteenths), lengthSixteenths: entry.lengthSixteenths,
      pitches: entry.element.kind === 'note' ? entry.element.pitches : [] }));
  if (hasCrossVoicePitchCollision(project.outline, spans)) return undefined;
  return { project: { ...project, outline: reconcileOutlineTies(outline) }, cursor: { ...cursor, positionSixteenths: position } };
}

/** Slash divides the selected ordinary note's existing time, requiring no extra rests. */
export function convertFocusedTimelineTuplet(project: ScoreProject, cursor: TimelineCursor) {
  if (!cursor.focusedNoteId || (cursor.selectionAnchorNoteId !== null && cursor.selectionAnchorNoteId !== cursor.focusedNoteId)) return undefined;
  for (const measure of project.outline) {
    if (measure.type !== 'measure') continue;
    const voice = measure.data[cursor.staff].voices[cursor.voiceIndex];
    if (!voice) continue;
    const note = voice.elements.find((element) => element.id === cursor.focusedNoteId);
    if (!note || note.kind !== 'note' || note.value.dots || note.tieFrom || note.tieTo) continue;
    const baseType = ({ half: 'quarter', quarter: 'eighth', eighth: '16th' } as const)[note.value.type as 'half' | 'quarter' | 'eighth'];
    if (!baseType) return undefined;
    const group: PianoTuplet = { id: 'tuplet-' + crypto.randomUUID(), kind: 'tuplet', actual: 3, normal: 2, baseType,
      elements: [{ ...note, value: { type: baseType, dots: 0 } }, ...Array.from({ length: 2 }, () => ({ id: createRestId(), kind: 'rest' as const, value: { type: baseType, dots: 0 } }))] };
    return { project: { ...project, outline: project.outline.map((block) => block !== measure ? block : {
      ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff], voices: block.data[cursor.staff].voices.map((old, index) => index !== cursor.voiceIndex ? old : { ...old, elements: old.elements.map((element) => element.id === note.id ? group : element) }) } },
    }) as ScoreProject['outline'] }, cursor };
  }
  return undefined;
}

export function getTupletPlacement(outline: readonly OutlineBlock[], cursor: TimelineCursor, position = cursor.positionSixteenths) {
  const context = getTupletContext(outline, cursor, position, false);
  if (!context) return undefined;
  const writtenStart = toNumber(multiply(fromNumber(addTime(position, -context.start)), rational(context.group.actual, context.group.normal)));
  if (!Number.isInteger(writtenStart / context.base)) return undefined;
  const end = writtenStart + context.base;
  if (end > context.base * context.group.actual || writtenNotes(context).some((entry) => entry.start < end && entry.start + entry.length > writtenStart)) return undefined;
  return { ...context, writtenStart, length: context.step };
}
export function addTupletTimelineNote(project: ScoreProject, cursor: TimelineCursor, position: number, pitch: number) {
  const context = getTupletPlacement(project.outline, cursor, position);
  if (!context || !Number.isInteger(pitch) || pitch < 21 || pitch > 108) return undefined;
  const note: PianoNote = { id: 'note-' + crypto.randomUUID(), kind: 'note', value: { type: context.group.baseType, dots: 0 }, pitches: [{ midi: pitch }] };
  const group = writeGroup(context, [...writtenNotes(context), { note, start: context.writtenStart, length: context.base }]);
  return group ? commit(project, { ...cursor, focusedNoteId: note.id, focusedPitchIndex: 0, selectionAnchorNoteId: null, pitch }, context, group, position, new Set([note.id])) : undefined;
}

export function setTupletNoteValue(project: ScoreProject, cursor: TimelineCursor, value: NoteValue) {
  const context = getTupletContext(project.outline, cursor);
  if (!context || value.dots !== 0) return undefined;
  const notes = writtenNotes(context);
  const selected = notes.find(({ note }) => note.id === cursor.focusedNoteId);
  const length = getNoteValueSixteenths(value);
  if (!selected || selected.note.tieFrom || selected.note.tieTo || !Number.isInteger(length / context.base) || length < context.base) return undefined;
  if (selected.note.value.type === value.type && selected.note.value.dots === value.dots) return undefined;
  const updated = { ...selected, length, note: { ...selected.note, value: { ...value } } };
  const group = writeGroup(context, notes.map((entry) => entry === selected ? updated : entry));
  return group ? commit(project, cursor, context, group, cursor.positionSixteenths, new Set([selected.note.id])) : undefined;
}
export function resizeTupletNote(project: ScoreProject, cursor: TimelineCursor, direction: -1 | 1) {
  const context = getTupletContext(project.outline, cursor);
  if (!context) return undefined;
  const notes = writtenNotes(context);
  const selected = notes.find(({ note }) => note.id === cursor.focusedNoteId);
  if (!selected || selected.note.tieFrom || selected.note.tieTo) return undefined;
  const length = selected.length + direction * context.base;
  if (length < context.base || length + selected.start > context.base * context.group.actual) return undefined;
  if (notes.length === 1 && selected.start === 0 && length === context.base * context.group.actual) {
    const value = valueForLength(context.base * context.group.normal);
    if (!value) return undefined;
    return commit(project, cursor, context, { ...selected.note, value }, context.start);
  }
  const value = valueForLength(length);
  if (!value) return undefined;
  const group = writeGroup(context, notes.map((entry) => entry === selected ? { ...entry, length, note: { ...entry.note, value } } : entry));
  return group ? commit(project, cursor, context, group, cursor.positionSixteenths, new Set([selected.note.id])) : undefined;
}
function valueForLength(length: number): NoteValue | undefined {
  for (const type of ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const) for (const dots of [0, 1]) {
    const value = { type, dots };
    if (getNoteValueSixteenths(value) === length) return value;
  }
  return undefined;
}

export function isFullTupletSelection(context: Context, ids: ReadonlySet<string>): boolean {
  const notes = writtenNotes(context);
  const selected = notes.filter(({ note }) => ids.has(note.id));
  return selected.length > 0 && selected.length === notes.length &&
    Math.min(...selected.map((entry) => entry.start)) === 0 &&
    Math.max(...selected.map((entry) => entry.start + entry.length)) === context.base * context.group.actual;
}

/** A mixed selection moves atomically only when every included group is selected through both edges. */
export function moveTupletSelection(project: ScoreProject, cursor: TimelineCursor, ids: ReadonlySet<string>, direction: -1 | 1) {
  const groups = getTupletContexts(project.outline, cursor).map((context) => {
    const notes = writtenNotes(context);
    const selected = notes.filter(({ note }) => ids.has(note.id));
    const complete = isFullTupletSelection(context, ids);
    return { context, notes, selected, complete };
  }).filter((group) => group.selected.length > 0);
  const groupedCount = groups.reduce((sum, group) => sum + group.selected.length, 0);
  if (!groups.length) return undefined;
  // One group's partial selection (including a sole focused note) still moves internally.
  if (groups.length === 1 && groupedCount === ids.size && !(ids.size > 1 && groups[0].complete)) {
    const { context, notes } = groups[0];
    const shifted = notes.map((entry) => ids.has(entry.note.id) ? { ...entry, start: entry.start + direction * context.base } : entry);
    if (shifted.some((entry) => entry.start < 0)) return undefined;
    const group = writeGroup(context, shifted);
    return group ? commit(project, cursor, context, group, addTime(cursor.positionSixteenths, direction * context.step), ids) : undefined;
  }
  if (groups.some((group) => !group.complete)) return undefined;
  const atoms: { element: PianoNote | PianoTuplet; start: number; length: number }[] = groups.map(({ context }) => ({
    element: context.group, start: context.start, length: context.end - context.start,
  }));
  let offset = 0;
  let ordinaryCount = 0;
  for (const block of project.outline) {
    if (block.type !== 'measure') continue;
    const voice = block.data[cursor.staff].voices[cursor.voiceIndex];
    if (voice) for (const entry of getLocatedVoiceElements(voice, block.data.length)) {
      if (entry.element.kind === 'note' && ids.has(entry.element.id)) {
        ordinaryCount++;
        atoms.push({ element: entry.element, start: addTime(offset, entry.positionSixteenths), length: entry.lengthSixteenths });
      }
    }
    offset += block.data.length.cnt / block.data.length.unit * 16;
  }
  if (ordinaryCount + groupedCount !== ids.size) return undefined;
  const shift = direction * getNoteValueSixteenths(cursor.placementValue);
  if (!isOnEditingGrid(shift) || shift === 0) return undefined;
  const movingIds = new Set(atoms.map(({ element }) => element.id));
  // Vacate every source before placing any destination, allowing overlapping range moves.
  let outline = project.outline.map((block) => block.type !== 'measure' ? block : {
    ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff], voices: block.data[cursor.staff].voices.map((voice, index) => index !== cursor.voiceIndex ? voice : {
      ...voice, elements: getLocatedVoiceElements(voice, block.data.length).flatMap((entry): PianoVoiceElement[] => {
        if (!movingIds.has(entry.element.id)) return [entry.element];
        return entry.element.kind === 'note'
          ? [{ id: createRestId(), kind: 'rest', value: { ...entry.element.value } }]
          : createRestElements(entry.positionSixteenths, entry.lengthSixteenths);
      }),
    }) } },
  }) as ScoreProject['outline'];
  for (const atom of atoms.sort((a, b) => a.start - b.start)) {
    const target = addTime(atom.start, shift);
    if (target < 0 || !isOnEditingGrid(target)) return undefined;
    let measureStart = 0;
    let placed = false;
    const spans: Parameters<typeof hasCrossVoicePitchCollision>[1][number][] = [];
    outline = outline.map((block) => {
      if (block.type !== 'measure') return block;
      const start = measureStart;
      measureStart += block.data.length.cnt / block.data.length.unit * 16;
      if (target < start || target >= measureStart) return block;
      const voice = block.data[cursor.staff].voices[cursor.voiceIndex];
      if (!voice || target + atom.length > measureStart) return block;
      const local = target - start;
      const hit = getLocatedVoiceElements(voice, block.data.length).filter((entry) => entry.positionSixteenths < local + atom.length && entry.positionSixteenths + entry.lengthSixteenths > local);
      if (!hit.length || hit.some(({ element }) => element.kind !== 'rest' && element.kind !== 'measure-rest')) return block;
      const first = hit[0], last = hit[hit.length - 1];
      const elements: PianoVoiceElement[] = [...voice.elements.slice(0, first.index), ...createRestElements(first.positionSixteenths, local - first.positionSixteenths), atom.element,
        ...createRestElements(local + atom.length, last.positionSixteenths + last.lengthSixteenths - local - atom.length), ...voice.elements.slice(last.index + 1)];
      for (const entry of getFlattenedVoiceElements({ id: voice.id, elements: [atom.element] }, block.data.length)) {
        if (entry.element.kind !== 'note') continue;
        spans.push({ staff: cursor.staff, voiceId: voice.id, startSixteenths: addTime(target, entry.positionSixteenths), lengthSixteenths: entry.lengthSixteenths, pitches: entry.element.pitches });
      }
      placed = true;
      return { ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff], voices: block.data[cursor.staff].voices.map((old, index) => index !== cursor.voiceIndex ? old : { ...old, elements }) } } };
    }) as ScoreProject['outline'];
    if (!placed || hasCrossVoicePitchCollision(project.outline, spans)) return undefined;
  }
  return { project: { ...project, outline: reconcileOutlineTies(outline) }, cursor: { ...cursor, positionSixteenths: addTime(cursor.positionSixteenths, shift) } };
}
