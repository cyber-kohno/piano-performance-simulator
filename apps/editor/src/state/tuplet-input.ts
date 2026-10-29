import { createRestElements, createRestId, getLocatedVoiceElements, getNoteValueSixteenths, isOnEditingGrid, type OutlineBlock, type PianoNote, type PianoTuplet, type ScoreProject } from '../model/project.ts';
import { addTime, compareTime, fromNumber, multiply, rational, toNumber } from '../model/rational.ts';
import { hasCrossVoicePitchCollision } from '../model/pitch-collision.ts';
import type { TimelineCursor } from './timeline-cursor.ts';

export function getTupletPlacement(outline: readonly OutlineBlock[], cursor: TimelineCursor, position = cursor.positionSixteenths) {
  const ratio = cursor.tuplet;
  if (!ratio || ratio.actual !== 3 || ratio.normal !== 2 || !['quarter', 'eighth', '16th'].includes(cursor.placementValue.type) || cursor.placementValue.dots !== 0) return undefined;
  let start = 0;
  for (const measure of outline) {
    if (measure.type !== 'measure') continue;
    const measureLength = measure.data.length.cnt / measure.data.length.unit * 16;
    const end = start + measureLength;
    if (compareTime(position, start) < 0 || compareTime(position, end) >= 0) { start = end; continue; }
    const voice = measure.data[cursor.staff].voices[cursor.voiceIndex];
    if (!voice) return undefined;
    const local = addTime(position, -start);
    const length = getNoteValueSixteenths(cursor.placementValue) * ratio.normal / ratio.actual;
    const entries = getLocatedVoiceElements(voice, measure.data.length);
    const existing = entries.find((entry) => entry.element.kind === 'tuplet' && compareTime(local, entry.positionSixteenths) >= 0 && compareTime(local, addTime(entry.positionSixteenths, entry.lengthSixteenths)) < 0);
    if (existing && existing.element.kind === 'tuplet') {
      const group = existing.element;
      if (group.actual !== ratio.actual || group.normal !== ratio.normal) return undefined;
      // Convert performed time back to the group's written time before slicing rests.
      const writtenStart = toNumber(multiply(fromNumber(addTime(local, -existing.positionSixteenths)), rational(group.actual, group.normal)));
      const writtenEnd = writtenStart + getNoteValueSixteenths(cursor.placementValue);
      // Sixteenth triplets are the smallest supported subdivision inside a group.
      if (!Number.isInteger(writtenStart)) return undefined;
      let writtenPosition = 0;
      const children = group.elements.map((element, index) => {
        const start = writtenPosition;
        writtenPosition += getNoteValueSixteenths(element.value);
        return { element, index, start, end: writtenPosition };
      });
      if (writtenEnd > writtenPosition) return undefined;
      const hit = children.filter((entry) => entry.start < writtenEnd && entry.end > writtenStart);
      if (!hit.length || hit.some(({ element }) => element.kind !== 'rest')) return undefined;
      const first = hit[0], last = hit[hit.length - 1];
      return { measure, voice, local, length, rootIndex: existing.index, group, first: undefined, last: undefined,
        replacement: { firstIndex: first.index, lastIndex: last.index,
          prefix: createRestElements(first.start, writtenStart - first.start),
          suffix: createRestElements(writtenEnd, last.end - writtenEnd) } };
    }
    const span = getNoteValueSixteenths(cursor.placementValue) * ratio.normal;
    if (!isOnEditingGrid(local) || compareTime(local + span, measureLength) > 0) return undefined;
    const hit = entries.filter((entry) => compareTime(entry.positionSixteenths, local + span) < 0 && compareTime(addTime(entry.positionSixteenths, entry.lengthSixteenths), local) > 0);
    if (!hit.length || hit.some(({ element }) => element.kind !== 'rest' && element.kind !== 'measure-rest')) return undefined;
    return { measure, voice, local, length, rootIndex: hit[0].index, childIndex: 0, group: undefined, first: hit[0], last: hit[hit.length - 1] };
  }
  return undefined;
}

export function addTupletTimelineNote(project: ScoreProject, cursor: TimelineCursor, position: number, pitch: number) {
  const target = getTupletPlacement(project.outline, cursor, position);
  if (!target || !Number.isInteger(pitch) || pitch < 21 || pitch > 108 || hasCrossVoicePitchCollision(project.outline, [{
    staff: cursor.staff, voiceId: target.voice.id, startSixteenths: position, lengthSixteenths: target.length, pitches: [{ midi: pitch }],
  }])) return undefined;
  const note: PianoNote = { id: `note-${crypto.randomUUID()}`, kind: 'note', value: { ...cursor.placementValue }, pitches: [{ midi: pitch }] };
  const group: PianoTuplet = target.group ? { ...target.group, elements: [
    ...target.group.elements.slice(0, target.replacement!.firstIndex), ...target.replacement!.prefix,
    note, ...target.replacement!.suffix, ...target.group.elements.slice(target.replacement!.lastIndex + 1),
  ] } : {
    id: `tuplet-${crypto.randomUUID()}`, kind: 'tuplet', ...cursor.tuplet!, baseType: cursor.placementValue.type,
    elements: Array.from({ length: cursor.tuplet!.actual }, (_, index) => index === 0 ? note : {
      id: createRestId(), kind: 'rest', value: { ...cursor.placementValue },
    }),
  };
  const elements = [...target.voice.elements];
  if (target.group) elements[target.rootIndex] = group;
  else {
    const first = target.first!, last = target.last!;
    const end = target.local + getNoteValueSixteenths(cursor.placementValue) * cursor.tuplet!.normal;
    elements.splice(first.index, last.index - first.index + 1,
      ...createRestElements(first.positionSixteenths, target.local - first.positionSixteenths), group,
      ...createRestElements(end, last.positionSixteenths + last.lengthSixteenths - end));
  }
  return {
    project: { ...project, outline: project.outline.map((block) => block !== target.measure ? block : {
      ...block, data: { ...block.data, [cursor.staff]: { ...block.data[cursor.staff], voices: block.data[cursor.staff].voices.map((voice, index) => index !== cursor.voiceIndex ? voice : { ...voice, elements }) } },
    }) as ScoreProject['outline'] },
    cursor: { ...cursor, positionSixteenths: position, pitch, focusedNoteId: note.id, focusedPitchIndex: 0, selectionAnchorNoteId: null },
  };
}
