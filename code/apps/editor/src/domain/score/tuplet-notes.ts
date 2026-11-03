
import VoiceCollision from "./voice-collision.ts";

import MusicalTime from "../theory/musical-time.ts";
import ScoreTies from "./score-ties.ts";
import NotationGrid from "./notation-grid.ts";
import WrittenValue from "../theory/written-value.ts";
import ScoreVoice from "./score-voice.ts";
import RestSpelling from "./rest-spelling.ts";
import {
  type NoteValue,
  type OutlineBlock,
  type PianoNote,
  type PianoRest,
  type PianoTuplet,
  type PianoVoiceElement,
  type ScoreProject,
} from "./types.ts";

import NoteOrder from './note-order.ts';
import type { VoiceScope } from './note-target.ts';
export type TupletTarget = VoiceScope & { position: number; noteId: string | null };
namespace TupletNotes {

  export function contexts(outline: readonly OutlineBlock[], target: TupletTarget) {
    const contexts = [];
    let measureStart = 0;
    for (const measure of outline) {
      if (measure.type !== 'measure') continue;
      const start = measureStart;
      measureStart += measure.data.length.cnt / measure.data.length.unit * 16;
      const voice = measure.data[target.staff].voices[target.voiceIndex];
      if (!voice) continue;
      for (const entry of ScoreVoice.locate(voice, measure.data.length)) {
        if (entry.element.kind !== 'tuplet') continue;
        const group = entry.element;
        const groupStart = MusicalTime.addNumbers(start, entry.positionSixteenths);
        const groupEnd = MusicalTime.addNumbers(groupStart, entry.lengthSixteenths);
        contexts.push({
          measure, measureStart: start, voice, entry, group, start: groupStart, end: groupEnd,
          base: WrittenValue.sixteenths({ type: group.baseType, dots: 0 }),
          step: WrittenValue.sixteenths({ type: group.baseType, dots: 0 }) * group.normal / group.actual
        });
      }
    }
    return contexts;
  }
  export function context(outline: readonly OutlineBlock[], target: TupletTarget, position = target.position, useFocus = true) {
    return contexts(outline, target).find((context) => useFocus && target.noteId !== null
      ? context.group.elements.some((child) => child.id === target.noteId)
      : MusicalTime.compareNumbers(position, context.start) >= 0 && MusicalTime.compareNumbers(position, context.end) < 0);
  }
  type Context = NonNullable<ReturnType<typeof context>>;
  function writtenNotes(context: Context) {
    let position = 0;
    return context.group.elements.flatMap((element) => {
      const start = position;
      position += WrittenValue.sixteenths(element.value);
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
      oldPosition += WrittenValue.sixteenths(element.value);
      return element.kind === 'rest' && !changed.some((entry) => entry.start < oldPosition && entry.start + entry.length > start)
        ? [{ note: element, start, length: oldPosition - start }] : [];
    });
    let position = 0;
    const elements: (PianoNote | PianoRest)[] = [];
    for (const entry of [...notes, ...preservedRests].sort((a, b) => a.start - b.start)) {
      if (entry.start < position || entry.start + entry.length > context.base * context.group.actual) return undefined;
      elements.push(...RestSpelling.create(position, entry.start - position), entry.note);
      position = entry.start + entry.length;
    }
    elements.push(...RestSpelling.create(position, context.base * context.group.actual - position));
    return { ...context.group, elements };
  }
  function commit(project: ScoreProject, target: TupletTarget, context: Context, element: PianoNote | PianoTuplet, position = target.position, editedIds?: ReadonlySet<string>) {
    const outline = project.outline.map((block) => block !== context.measure ? block : {
      ...block, data: {
        ...block.data, [target.staff]: {
          ...block.data[target.staff], voices: block.data[target.staff].voices.map((voice, index) => index !== target.voiceIndex ? voice : {
            ...voice, elements: voice.elements.map((old) => old.id === context.group.id ? element : old),
          })
        }
      },
    }) as ScoreProject['outline'];
    const changedIds = editedIds ?? new Set(element.kind === 'note' ? [element.id] : element.elements.filter((child) => child.kind === 'note').map((child) => child.id));
    const changedVoice = outline.find((block) => block.id === context.measure.id);
    if (changedVoice?.type !== 'measure') return undefined;
    const spans = ScoreVoice.flatten(changedVoice.data[target.staff].voices[target.voiceIndex], changedVoice.data.length)
      .filter(({ element }) => changedIds.has(element.id)).map((entry) => ({
        staff: target.staff, voiceId: context.voice.id,
        startSixteenths: MusicalTime.addNumbers(context.measureStart, entry.positionSixteenths), lengthSixteenths: entry.lengthSixteenths,
        pitches: entry.element.kind === 'note' ? entry.element.pitches : []
      }));
    if (VoiceCollision.exists(project.outline, spans)) return undefined;
    return { project: { ...project, outline: ScoreTies.reconcile(outline) }, position };
  }

  /** Slash divides the selected ordinary note's existing time, requiring no extra rests. */
  export function convert(project: ScoreProject, target: TupletTarget) {
    if (!target.noteId) return undefined;
    for (const measure of project.outline) {
      if (measure.type !== 'measure') continue;
      const voice = measure.data[target.staff].voices[target.voiceIndex];
      if (!voice) continue;
      const note = voice.elements.find((element) => element.id === target.noteId);
      if (!note || note.kind !== 'note' || note.value.dots || note.tieFrom || note.tieTo) continue;
      const baseType = ({ half: 'quarter', quarter: 'eighth', eighth: '16th' } as const)[note.value.type as 'half' | 'quarter' | 'eighth'];
      if (!baseType) return undefined;
      const group: PianoTuplet = {
        id: 'tuplet-' + crypto.randomUUID(), kind: 'tuplet', actual: 3, normal: 2, baseType,
        elements: [{ ...note, value: { type: baseType, dots: 0 } }, ...Array.from({ length: 2 }, () => ({ id: RestSpelling.createId(), kind: 'rest' as const, value: { type: baseType, dots: 0 } }))]
      };
      return {
        project: {
          ...project, outline: project.outline.map((block) => block !== measure ? block : {
            ...block, data: { ...block.data, [target.staff]: { ...block.data[target.staff], voices: block.data[target.staff].voices.map((old, index) => index !== target.voiceIndex ? old : { ...old, elements: old.elements.map((element) => element.id === note.id ? group : element) }) } },
          }) as ScoreProject['outline']
        }, position: target.position
      };
    }
    return undefined;
  }

  export function placement(outline: readonly OutlineBlock[], target: TupletTarget, position = target.position) {
    const context = TupletNotes.context(outline, target, position, false);
    if (!context) return undefined;
    const writtenStart = MusicalTime.toNumber(MusicalTime.multiply(MusicalTime.fromNumber(MusicalTime.addNumbers(position, -context.start)), MusicalTime.create(context.group.actual, context.group.normal)));
    if (!Number.isInteger(writtenStart / context.base)) return undefined;
    const end = writtenStart + context.base;
    if (end > context.base * context.group.actual || writtenNotes(context).some((entry) => entry.start < end && entry.start + entry.length > writtenStart)) return undefined;
    return { ...context, writtenStart, length: context.step };
  }
  export function add(project: ScoreProject, target: TupletTarget, position: number, pitch: number) {
    const context = placement(project.outline, target, position);
    if (!context || !Number.isInteger(pitch) || pitch < 21 || pitch > 108) return undefined;
    const note: PianoNote = { id: 'note-' + crypto.randomUUID(), kind: 'note', value: { type: context.group.baseType, dots: 0 }, pitches: [{ midi: pitch }] };
    const group = writeGroup(context, [...writtenNotes(context), { note, start: context.writtenStart, length: context.base }]);
    const result = group ? commit(project, target, context, group, position, new Set([note.id])) : undefined;
    return result && { ...result, noteId: note.id, pitchIndex: 0, pitch };
  }

  export function setValue(project: ScoreProject, target: TupletTarget, value: NoteValue) {
    const context = TupletNotes.context(project.outline, target);
    if (!context || value.dots !== 0) return undefined;
    const notes = writtenNotes(context);
    const selected = notes.find(({ note }) => note.id === target.noteId);
    const length = WrittenValue.sixteenths(value);
    if (!selected || selected.note.tieFrom || selected.note.tieTo || !Number.isInteger(length / context.base) || length < context.base) return undefined;
    if ((selected.note.beforeGraceNotes?.length || selected.note.arpeggio) && value.type === '32nd') return undefined;
    if (selected.note.value.type === value.type && selected.note.value.dots === value.dots) return undefined;
    const updated = { ...selected, length, note: { ...selected.note, value: { ...value } } };
    const group = writeGroup(context, notes.map((entry) => entry === selected ? updated : entry));
    return group ? commit(project, target, context, group, target.position, new Set([selected.note.id])) : undefined;
  }
  export function resize(project: ScoreProject, target: TupletTarget, direction: -1 | 1) {
    const context = TupletNotes.context(project.outline, target);
    if (!context) return undefined;
    const notes = writtenNotes(context);
    const selected = notes.find(({ note }) => note.id === target.noteId);
    if (!selected || selected.note.tieFrom || selected.note.tieTo) return undefined;
    const length = selected.length + direction * context.base;
    if (length < context.base || length + selected.start > context.base * context.group.actual) return undefined;
    if (notes.length === 1 && selected.start === 0 && length === context.base * context.group.actual) {
      const value = valueForLength(context.base * context.group.normal);
      if (!value) return undefined;
      return commit(project, target, context, { ...selected.note, value }, context.start);
    }
    const value = valueForLength(length);
    if (!value) return undefined;
    if ((selected.note.beforeGraceNotes?.length || selected.note.arpeggio) && value.type === '32nd') return undefined;
    const group = writeGroup(context, notes.map((entry) => entry === selected ? { ...entry, length, note: { ...entry.note, value } } : entry));
    return group ? commit(project, target, context, group, target.position, new Set([selected.note.id])) : undefined;
  }
  function valueForLength(length: number): NoteValue | undefined {
    for (const type of ['whole', 'half', 'quarter', 'eighth', '16th', '32nd'] as const) for (const dots of [0, 1]) {
      const value = { type, dots };
      if (WrittenValue.sixteenths(value) === length) return value;
    }
    return undefined;
  }

  export function selectionCoversEdges(context: Context, ids: ReadonlySet<string>): boolean {
    const notes = writtenNotes(context);
    const selected = notes.filter(({ note }) => ids.has(note.id));
    return selected.length > 0 && selected.length === notes.length &&
      Math.min(...selected.map((entry) => entry.start)) === 0 &&
      Math.max(...selected.map((entry) => entry.start + entry.length)) === context.base * context.group.actual;
  }

  /** A mixed selection moves atomically only when every included group is selected through both edges. */
  export function move(project: ScoreProject, target: TupletTarget, ids: ReadonlySet<string>, direction: -1 | 1, unit: number) {
    const groups = contexts(project.outline, target).map((context) => {
      const notes = writtenNotes(context);
      const selected = notes.filter(({ note }) => ids.has(note.id));
      const complete = selectionCoversEdges(context, ids);
      return { context, notes, selected, complete };
    }).filter((group) => group.selected.length > 0);
    const groupedCount = groups.reduce((sum, group) => sum + group.selected.length, 0);
    if (!groups.length) return undefined;
    // One group's partial selection (including a sole focused note) still moves internally.
    if (groups.length === 1 && groupedCount === ids.size && !(ids.size > 1 && groups[0].complete)) {
      const { context, notes } = groups[0];
      if (NoteOrder.crosses(notes.filter(entry => ids.has(entry.note.id)), notes.filter(entry => !ids.has(entry.note.id)), direction * context.base)) return undefined;
      const shifted = notes.map((entry) => ids.has(entry.note.id) ? { ...entry, start: entry.start + direction * context.base } : entry);
      if (shifted.some((entry) => entry.start < 0)) return undefined;
      const group = writeGroup(context, shifted);
      return group ? commit(project, target, context, group, MusicalTime.addNumbers(target.position, direction * context.step), ids) : undefined;
    }
    if (groups.some((group) => !group.complete)) return undefined;
    const atoms: { element: PianoNote | PianoTuplet; start: number; length: number }[] = groups.map(({ context }) => ({
      element: context.group, start: context.start, length: context.end - context.start,
    }));
    let offset = 0;
    let ordinaryCount = 0;
    for (const block of project.outline) {
      if (block.type !== 'measure') continue;
      const voice = block.data[target.staff].voices[target.voiceIndex];
      if (voice) for (const entry of ScoreVoice.locate(voice, block.data.length)) {
        if (entry.element.kind === 'note' && ids.has(entry.element.id)) {
          ordinaryCount++;
          atoms.push({ element: entry.element, start: MusicalTime.addNumbers(offset, entry.positionSixteenths), length: entry.lengthSixteenths });
        }
      }
      offset += block.data.length.cnt / block.data.length.unit * 16;
    }
    if (ordinaryCount + groupedCount !== ids.size) return undefined;
    const shift = direction * unit;
    if (!NotationGrid.contains(shift) || shift === 0) return undefined;
    const movingIds = new Set(atoms.map(({ element }) => element.id));
    let stationaryStart = 0;
    const stationary = project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const start = stationaryStart;
      stationaryStart = MusicalTime.addNumbers(start, block.data.length.cnt / block.data.length.unit * 16);
      const voice = block.data[target.staff].voices[target.voiceIndex];
      return voice ? ScoreVoice.flatten(voice, block.data.length).flatMap(entry =>
        entry.element.kind === 'note' && !ids.has(entry.element.id)
          ? [{ start: MusicalTime.addNumbers(start, entry.positionSixteenths), length: entry.lengthSixteenths }] : []) : [];
    });
    if (NoteOrder.crosses(atoms, stationary, shift)) return undefined;
    // Vacate every source before placing any destination, allowing overlapping range moves.
    let outline = project.outline.map((block) => block.type !== 'measure' ? block : {
      ...block, data: {
        ...block.data, [target.staff]: {
          ...block.data[target.staff], voices: block.data[target.staff].voices.map((voice, index) => index !== target.voiceIndex ? voice : {
            ...voice, elements: ScoreVoice.locate(voice, block.data.length).flatMap((entry): PianoVoiceElement[] => {
              if (!movingIds.has(entry.element.id)) return [entry.element];
              return entry.element.kind === 'note'
                ? [{ id: RestSpelling.createId(), kind: 'rest', value: { ...entry.element.value } }]
                : RestSpelling.create(entry.positionSixteenths, entry.lengthSixteenths);
            }),
          })
        }
      },
    }) as ScoreProject['outline'];
    for (const atom of atoms.sort((a, b) => a.start - b.start)) {
      const destination = MusicalTime.addNumbers(atom.start, shift);
      if (destination < 0 || !NotationGrid.contains(destination)) return undefined;
      let measureStart = 0;
      let placed = false;
      const spans: Parameters<typeof VoiceCollision.exists>[1][number][] = [];
      outline = outline.map((block) => {
        if (block.type !== 'measure') return block;
        const start = measureStart;
        measureStart += block.data.length.cnt / block.data.length.unit * 16;
        if (destination < start || destination >= measureStart) return block;
        const voice = block.data[target.staff].voices[target.voiceIndex];
        if (!voice || destination + atom.length > measureStart) return block;
        const local = destination - start;
        const hit = ScoreVoice.locate(voice, block.data.length).filter((entry) => entry.positionSixteenths < local + atom.length && entry.positionSixteenths + entry.lengthSixteenths > local);
        if (!hit.length || hit.some(({ element }) => element.kind !== 'rest' && element.kind !== 'measure-rest')) return block;
        const first = hit[0], last = hit[hit.length - 1];
        const elements: PianoVoiceElement[] = [...voice.elements.slice(0, first.index), ...RestSpelling.create(first.positionSixteenths, local - first.positionSixteenths), atom.element,
        ...RestSpelling.create(local + atom.length, last.positionSixteenths + last.lengthSixteenths - local - atom.length), ...voice.elements.slice(last.index + 1)];
        for (const entry of ScoreVoice.flatten({ id: voice.id, elements: [atom.element] }, block.data.length)) {
          if (entry.element.kind !== 'note') continue;
          spans.push({ staff: target.staff, voiceId: voice.id, startSixteenths: MusicalTime.addNumbers(destination, entry.positionSixteenths), lengthSixteenths: entry.lengthSixteenths, pitches: entry.element.pitches });
        }
        placed = true;
        return { ...block, data: { ...block.data, [target.staff]: { ...block.data[target.staff], voices: block.data[target.staff].voices.map((old, index) => index !== target.voiceIndex ? old : { ...old, elements }) } } };
      }) as ScoreProject['outline'];
      if (!placed || VoiceCollision.exists(project.outline, spans)) return undefined;
    }
    return { project: { ...project, outline: ScoreTies.reconcile(outline) }, position: MusicalTime.addNumbers(target.position, shift) };
  }

}
export default TupletNotes;
