import MusicalTime from '../theory/musical-time.ts';
import ScoreTimeline, { type LocatedTimelineNote } from './score-timeline.ts';
import ScoreVoice from './score-voice.ts';
import ScoreTies from './score-ties.ts';
import VoiceCollision from './voice-collision.ts';
import NotationGrid from './notation-grid.ts';
import RestSpelling from './rest-spelling.ts';
import type { MeasureLength, PianoNote, PianoTuplet, PianoVoiceElement, PianoStaffName, ScoreProject } from './types.ts';

export type PassageAtom = {
  offsetSixteenths: number;
  durationSixteenths: number;
  element: PianoNote | PianoTuplet;
};
export type ScorePassage = {
  durationSixteenths: number;
  atoms: PassageAtom[];
};
export type PassagePasteFailureReason = 'invalid-passage' | 'outside-score' | 'crosses-measure' |
  'voice-unavailable' | 'invalid-position' | 'occupied' | 'tuplet-boundary' | 'pitch-collision';
export type PassagePasteResult =
  | { ok: true; project: ScoreProject; noteIds: string[] }
  | { ok: false; reason: PassagePasteFailureReason };

namespace ScorePassage {
  function noteIds(element: PianoNote | PianoTuplet): string[] {
    return element.kind === 'note' ? [element.id]
      : element.elements.flatMap(child => child.kind === 'note' ? [child.id] : []);
  }

  function absolute(entry: LocatedTimelineNote): number {
    return MusicalTime.addNumbers(entry.measureStartSixteenths, entry.positionSixteenths);
  }

  function snapshotNote(note: PianoNote): PianoNote {
    return {
      ...note,
      value: { ...note.value },
      pitches: note.pitches.map(pitch => ({ ...pitch })),
      ...(note.staccato ? { staccato: { ...note.staccato } } : {}),
      ...(note.accent ? { accent: { ...note.accent } } : {}),
      ...(note.fermata ? { fermata: { ...note.fermata } } : {}),
      ...(note.arpeggio ? { arpeggio: { ...note.arpeggio } } : {}),
      ...(note.gracePerformance ? { gracePerformance: { ...note.gracePerformance } } : {}),
      ...(note.beforeGraceNotes ? { beforeGraceNotes: note.beforeGraceNotes.map(grace => ({
        ...grace,
        value: { ...grace.value },
        pitches: grace.pitches.map(pitch => ({ ...pitch })),
      })) } : {}),
    };
  }

  function snapshotAtom(element: PianoNote | PianoTuplet): PianoNote | PianoTuplet {
    return element.kind === 'note' ? snapshotNote(element) : {
      ...element,
      elements: element.elements.map(child => child.kind === 'note' ? snapshotNote(child) : {
        ...child, value: { ...child.value },
      }),
    };
  }

  /** Captures the selected note span and its relative timing. Tuplets are indivisible atoms. */
  export function copy(outline: ScoreProject['outline'], staff: PianoStaffName, voiceIndex: number,
    selected: readonly LocatedTimelineNote[]): ScorePassage | undefined {
    if (!selected.length) return undefined;
    const selectedIds = new Set(selected.map(entry => entry.note.id));
    const start = absolute(selected[0]);
    const last = selected.at(-1)!;
    const end = MusicalTime.addNumbers(absolute(last), last.lengthSixteenths);
    if (end <= start) return undefined;

    const atoms: PassageAtom[] = [];
    let measureStart = 0;
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      const voice = block.data[staff].voices[voiceIndex];
      if (voice) {
        for (const located of ScoreVoice.locate(voice, block.data.length)) {
          const element = located.element;
          const elementStart = MusicalTime.addNumbers(measureStart, located.positionSixteenths);
          const duration = located.lengthSixteenths;
          const elementEnd = MusicalTime.addNumbers(elementStart, duration);
          if (element.kind === 'note') {
            if (selectedIds.has(element.id)) atoms.push({
              offsetSixteenths: MusicalTime.addNumbers(elementStart, -start),
              durationSixteenths: duration,
              element,
            });
            else if (elementStart < end && elementEnd > start) return undefined;
          } else if (element.kind === 'tuplet') {
            const children = ScoreVoice.flatten({ id: voice.id, elements: [element] }, block.data.length)
              .filter(child => child.element.kind === 'note');
            const selectedChildren = children.filter(child => selectedIds.has(child.element.id));
            if (selectedChildren.length) {
              // A tuplet is copied as its original group, never as detached ordinary notes.
              if (selectedChildren.length !== children.length || elementStart < start || elementEnd > end) return undefined;
              atoms.push({
                offsetSixteenths: MusicalTime.addNumbers(elementStart, -start),
                durationSixteenths: duration,
                element,
              });
            } else if (children.length && elementStart < end && elementEnd > start) return undefined;
          }
        }
      }
      measureStart = MusicalTime.addNumbers(measureStart, block.data.length.cnt / block.data.length.unit * 16);
    }
    atoms.sort((a, b) => a.offsetSixteenths - b.offsetSixteenths);
    if (!atoms.length || atoms.flatMap(atom => noteIds(atom.element)).length !== selectedIds.size) return undefined;
    return {
      durationSixteenths: MusicalTime.addNumbers(end, -start),
      atoms: atoms.map(atom => ({ ...atom, element: snapshotAtom(atom.element) })),
    };
  }

  function everyRest(element: PianoTuplet): boolean {
    return element.elements.every(child => child.kind === 'rest');
  }

  type RestSpanResult = { ok: true; elements: PianoVoiceElement[] } |
    { ok: false; reason: 'occupied' | 'tuplet-boundary' | 'invalid-position' };

  function prepareRestSpan(elements: PianoVoiceElement[], measureLength: MeasureLength,
    start: number, end: number): RestSpanResult {
    const voice = { id: 'clipboard-target', elements };
    const entries = ScoreVoice.locate(voice, measureLength).filter(entry =>
      MusicalTime.compareNumbers(entry.positionSixteenths, end) < 0 &&
      MusicalTime.compareNumbers(MusicalTime.addNumbers(entry.positionSixteenths, entry.lengthSixteenths), start) > 0,
    );
    if (!entries.length) return { ok: false, reason: 'invalid-position' };
    for (const { element, positionSixteenths, lengthSixteenths } of entries) {
      if (element.kind === 'rest' || element.kind === 'measure-rest') continue;
      if (element.kind !== 'tuplet' || !everyRest(element)) return { ok: false, reason: 'occupied' };
      const tupletEnd = MusicalTime.addNumbers(positionSixteenths, lengthSixteenths);
      if (positionSixteenths < start || tupletEnd > end) return { ok: false, reason: 'tuplet-boundary' };
    }

    // Empty tuplets and measure rests covered by the whole passage become ordinary rests.
    const byIndex = new Map<number, typeof entries[number]>(entries.map(entry => [entry.index, entry] as const));
    const expanded = elements.flatMap((element, index) => {
      const entry = byIndex.get(index);
      if (!entry) return [element];
      if (element.kind === 'tuplet') return RestSpelling.create(entry.positionSixteenths, entry.lengthSixteenths);
      if (element.kind === 'measure-rest') return RestSpelling.create(entry.positionSixteenths, entry.lengthSixteenths);
      return [element];
    });
    const located = ScoreVoice.locate({ id: 'clipboard-target', elements: expanded }, measureLength).filter(entry =>
      MusicalTime.compareNumbers(entry.positionSixteenths, end) < 0 &&
      MusicalTime.compareNumbers(MusicalTime.addNumbers(entry.positionSixteenths, entry.lengthSixteenths), start) > 0,
    );
    return !located.length || located.some(entry => entry.element.kind !== 'rest')
      ? { ok: false, reason: 'invalid-position' } : { ok: true, elements: expanded };
  }

  function replaceRestSpan(elements: PianoVoiceElement[], measureLength: MeasureLength,
    start: number, end: number, replacement: PianoNote | PianoTuplet): RestSpanResult {
    const expanded = prepareRestSpan(elements, measureLength, start, end);
    if (!expanded.ok) return expanded;
    const located = ScoreVoice.locate({ id: 'clipboard-target', elements: expanded.elements }, measureLength).filter(entry =>
      MusicalTime.compareNumbers(entry.positionSixteenths, end) < 0 &&
      MusicalTime.compareNumbers(MusicalTime.addNumbers(entry.positionSixteenths, entry.lengthSixteenths), start) > 0,
    );
    if (!located.length) return { ok: false, reason: 'invalid-position' };
    const first = located[0], last = located.at(-1)!;
    const lastEnd = MusicalTime.addNumbers(last.positionSixteenths, last.lengthSixteenths);
    if (first.positionSixteenths > start || lastEnd < end ||
      !NotationGrid.contains(start - first.positionSixteenths) || !NotationGrid.contains(lastEnd - end)) return { ok: false, reason: 'invalid-position' };
    return { ok: true, elements: [
      ...expanded.elements.slice(0, first.index),
      ...RestSpelling.create(first.positionSixteenths, start - first.positionSixteenths),
      replacement,
      ...RestSpelling.create(end, lastEnd - end),
      ...expanded.elements.slice(last.index + 1),
    ] };
  }

  function cloneAtoms(passage: ScorePassage) {
    const remappedIds = new Map<string, string>();
    for (const atom of passage.atoms) for (const id of noteIds(atom.element)) remappedIds.set(id, `note-${crypto.randomUUID()}`);
    const clonedNotes: string[] = [];
    function cloneNote(note: PianoNote): PianoNote {
      const next: PianoNote = {
        ...note,
        id: remappedIds.get(note.id)!,
        pitches: note.pitches.map(pitch => ({ ...pitch })),
        ...(note.staccato ? { staccato: { ...note.staccato } } : {}),
        ...(note.accent ? { accent: { ...note.accent } } : {}),
        ...(note.fermata ? { fermata: { ...note.fermata } } : {}),
        ...(note.arpeggio ? { arpeggio: { ...note.arpeggio } } : {}),
        ...(note.gracePerformance ? { gracePerformance: { ...note.gracePerformance } } : {}),
        ...(note.beforeGraceNotes?.length ? { beforeGraceNotes: note.beforeGraceNotes.map(grace => ({
          ...grace, id: `grace-${crypto.randomUUID()}`, value: { ...grace.value },
          pitches: grace.pitches.map(pitch => ({ ...pitch })),
        })) } : {}),
      };
      if (note.tieFrom && remappedIds.has(note.tieFrom)) next.tieFrom = remappedIds.get(note.tieFrom);
      else delete next.tieFrom;
      if (note.tieTo && remappedIds.has(note.tieTo)) next.tieTo = remappedIds.get(note.tieTo);
      else delete next.tieTo;
      clonedNotes.push(next.id);
      return next;
    }
    const atoms = passage.atoms.map(atom => ({
      offsetSixteenths: atom.offsetSixteenths,
      durationSixteenths: atom.durationSixteenths,
      element: atom.element.kind === 'note' ? cloneNote(atom.element) : {
        ...atom.element,
        id: `tuplet-${crypto.randomUUID()}`,
        elements: atom.element.elements.map(child => child.kind === 'note' ? cloneNote(child) : {
          ...child, id: `rest-${crypto.randomUUID()}`, value: { ...child.value },
        }),
      },
    }));
    return { atoms, clonedNotes };
  }

  /** Preflight the whole destination range, then replace rests in one measure atomically. */
  export function paste(project: ScoreProject, staff: PianoStaffName, voiceIndex: number, start: number,
    passage: ScorePassage): PassagePasteResult {
    if (!passage.atoms.length || passage.durationSixteenths <= 0 ||
      !NotationGrid.contains(start) || !NotationGrid.contains(passage.durationSixteenths)) return { ok: false, reason: 'invalid-passage' };
    const location = ScoreTimeline.measureAt(project.outline, start);
    if (!location) return { ok: false, reason: 'outside-score' };
    if (MusicalTime.compareNumbers(start + passage.durationSixteenths,
      location.startSixteenths + location.lengthSixteenths) > 0) return { ok: false, reason: 'crosses-measure' };
    const voice = location.measure.data[staff].voices[voiceIndex];
    if (!voice) return { ok: false, reason: 'voice-unavailable' };
    const localStart = MusicalTime.addNumbers(start, -location.startSixteenths);
    const localEnd = MusicalTime.addNumbers(localStart, passage.durationSixteenths);
    if (!NotationGrid.contains(localStart) || !NotationGrid.contains(localEnd)) return { ok: false, reason: 'invalid-position' };
    const copied = cloneAtoms(passage);
    const intervals = copied.atoms.map(atom => ({
      atom,
      start: MusicalTime.addNumbers(localStart, atom.offsetSixteenths),
      end: MusicalTime.addNumbers(MusicalTime.addNumbers(localStart, atom.offsetSixteenths), atom.durationSixteenths),
    }));
    const prepared = prepareRestSpan(voice.elements, location.measure.data.length, localStart, localEnd);
    if (!prepared.ok) return prepared;
    let elements = prepared.elements;
    // Sequentially replace each copied atom. Any note or partial tuplet collision aborts without mutation.
    for (const interval of intervals) {
      if (!NotationGrid.contains(interval.start) || !NotationGrid.contains(interval.end - interval.start)) return { ok: false, reason: 'invalid-position' };
      const replacement = replaceRestSpan(elements, location.measure.data.length, interval.start, interval.end, interval.atom.element);
      if (!replacement.ok) return replacement;
      elements = replacement.elements;
    }
    const outline = project.outline.map(block => block.id !== location.measure.id || block.type !== 'measure' ? block : {
      ...block,
      data: { ...block.data, [staff]: {
        ...block.data[staff],
        voices: block.data[staff].voices.map((item, index) => index === voiceIndex ? { ...item, elements } : item),
      } },
    }) as ScoreProject['outline'];
    const reconciled = ScoreTies.reconcile(outline);
    const next = { ...project, outline: reconciled };
    const spans = ScoreTimeline.notes(reconciled, staff, voiceIndex)
      .filter(entry => copied.clonedNotes.includes(entry.note.id))
      .map(entry => ({
        staff,
        voiceId: location.measure.data[staff].voices[voiceIndex].id,
        startSixteenths: MusicalTime.addNumbers(entry.measureStartSixteenths, entry.positionSixteenths),
        lengthSixteenths: entry.lengthSixteenths,
        pitches: entry.note.pitches,
      }));
    if (spans.length !== copied.clonedNotes.length) return { ok: false, reason: 'invalid-passage' };
    if (VoiceCollision.exists(project.outline, spans)) return { ok: false, reason: 'pitch-collision' };
    return { ok: true, project: next, noteIds: copied.clonedNotes };
  }
}

export default ScorePassage;
