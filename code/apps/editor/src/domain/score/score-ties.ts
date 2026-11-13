
import ScoreVoice from "./score-voice.ts";
import ScoreTimeline from './score-timeline.ts';
import ScoreNotes from './score-notes.ts';
import MusicalTime from "../theory/musical-time.ts";
import type { ScoreProject, PianoNote, PianoStaff, PianoStaffName } from './types.ts';

namespace ScoreTies {
  /** Moving notes can only invalidate their links and the reciprocal endpoints. */
  export function reconcileNotes(project: ScoreProject, staff: PianoStaffName, ids: ReadonlySet<string>): ScoreProject {
    const { outline } = project;
    if (!ScoreTimeline.isPrepared(outline)) return { ...project, outline: reconcile(outline) };
    const affected = new Set(ids);
    for (const id of ids) {
      const note = ScoreTimeline.note(outline, id, staff)?.note;
      if (note?.tieFrom) affected.add(note.tieFrom);
      if (note?.tieTo) affected.add(note.tieTo);
    }
    const valid = (fromId: string, toId: string): boolean => {
      const from = ScoreTimeline.note(outline, fromId, staff), to = ScoreTimeline.note(outline, toId, staff);
      return !!from && !!to && from.note.tieTo === toId && to.note.tieFrom === fromId &&
        from.measure.data[staff].voices[from.voiceIndex].id === to.measure.data[staff].voices[to.voiceIndex].id &&
        MusicalTime.compareNumbers(from.measureStartSixteenths + from.positionSixteenths + from.lengthSixteenths,
          to.measureStartSixteenths + to.positionSixteenths) === 0 &&
        from.note.pitches.length === to.note.pitches.length && from.note.pitches.every((pitch, index) =>
          pitch.midi === to.note.pitches[index].midi && pitch.spellingDirection === to.note.pitches[index].spellingDirection);
    };
    const nextProject = ScoreNotes.map(project, affected, note => {
      const keepFrom = !note.tieFrom || valid(note.tieFrom, note.id);
      const keepTo = !note.tieTo || valid(note.id, note.tieTo);
      if (keepFrom && keepTo) return note;
      const next = { ...note };
      if (!keepFrom) delete next.tieFrom;
      if (!keepTo) delete next.tieTo;
      return next;
    }, staff);
    ScoreTimeline.prepare(nextProject.outline);
    return nextProject;
  }
  /** Derive tie timing from the voice sequence after outline edits. */
  export function reconcile(outline: ScoreProject['outline']): ScoreProject['outline'] {
    const entries = new Map<string, { note: PianoNote; scope: string; start: number; end: number }>();
    let position = 0;
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      [block.data.upperStaff, block.data.lowerStaff].forEach((staff, staffIndex) => {
        staff.voices.forEach((voice) => {
          for (const entry of ScoreVoice.flatten(voice, block.data.length)) {
            if (entry.element.kind !== 'note') continue;
            const start = position + entry.positionSixteenths;
            entries.set(entry.element.id, {
              note: entry.element, start, end: start + entry.lengthSixteenths,
              scope: `${staffIndex}:${voice.id}`,
            });
          }
        });
      });
      position += block.data.length.cnt / block.data.length.unit * 16;
    }
    const valid = new Set<string>();
    for (const entry of entries.values()) {
      const next = entry.note.tieTo ? entries.get(entry.note.tieTo) : undefined;
      if (next && next.note.tieFrom === entry.note.id && entry.scope === next.scope &&
        MusicalTime.compare(MusicalTime.fromNumber(entry.end), MusicalTime.fromNumber(next.start)) === 0 &&
        entry.note.pitches.length === next.note.pitches.length &&
        entry.note.pitches.every((pitch, index) => pitch.midi === next.note.pitches[index].midi &&
          pitch.spellingDirection === next.note.pitches[index].spellingDirection)) valid.add(entry.note.id);
    }
    const cleanStaff = (staff: PianoStaff): PianoStaff => {
      const voices = staff.voices.map((voice) => ScoreVoice.mapNotes(voice, (element) => {
        const keepFrom = element.tieFrom !== undefined && valid.has(element.tieFrom) &&
          entries.get(element.tieFrom)?.note.tieTo === element.id;
        const keepTo = valid.has(element.id);
        if ((!element.tieFrom || keepFrom) && (!element.tieTo || keepTo)) return element;
        const next = { ...element };
        if (!keepFrom) delete next.tieFrom;
        if (!keepTo) delete next.tieTo;
        return next;
      }));
      return voices.every((voice, i) => voice === staff.voices[i]) ? staff : { ...staff, voices };
    };
    const result = outline.map(block => {
      if (block.type !== 'measure') return block;
      const upperStaff = cleanStaff(block.data.upperStaff), lowerStaff = cleanStaff(block.data.lowerStaff);
      return upperStaff === block.data.upperStaff && lowerStaff === block.data.lowerStaff ? block
        : { ...block, data: { ...block.data, upperStaff, lowerStaff } };
    }) as ScoreProject['outline'];
    return result.every((block, i) => block === outline[i]) ? outline : result;
  }

}
export default ScoreTies;
