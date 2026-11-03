import ScoreTimeline from './score-timeline.ts';
import ScoreTies from './score-ties.ts';
import type { ScoreProject, NoteValue } from './types.ts';
import type { NoteTarget, NoteTimeResult, VoiceScope } from './note-target.ts';
import NoteTargets from './note-target.ts';
import NotePlacement from './note-placement.ts';
import TupletNotes from './tuplet-notes.ts';
import ScoreNotes from './score-notes.ts';
import MusicalTime from '../theory/musical-time.ts';
namespace NoteContinuation {
  export function toggleAdjacent(project: ScoreProject, target: NoteTarget): ScoreProject | undefined {
    if (!NoteTargets.resolve(project, target)) return undefined;
    const notes = ScoreTimeline.notes(project.outline, target.staff, target.voiceIndex);
    const index = notes.findIndex(({ note }) => note.id === target.noteId);
    if (index < 0 || index + 1 >= notes.length) return undefined;
    const current = notes[index];
    const next = notes[index + 1];
    const currentEnd = MusicalTime.addNumbers(MusicalTime.addNumbers(current.measureStartSixteenths, current.positionSixteenths), current.lengthSixteenths);
    const nextStart = next.measureStartSixteenths + next.positionSixteenths;
    if (MusicalTime.compareNumbers(currentEnd, nextStart) !== 0 || current.note.pitches.length === 0 ||
      current.note.pitches.length !== next.note.pitches.length ||
      !current.note.pitches.every((pitch, pitchIndex) => pitch.midi === next.note.pitches[pitchIndex].midi)) {
      return undefined;
    }

    const isTied = current.note.tieTo === next.note.id && next.note.tieFrom === current.note.id;
    if (!isTied && next.note.arpeggio) return undefined;
    if (!isTied && (current.note.tieTo !== undefined || next.note.tieFrom !== undefined)) return undefined;
    const updated = ScoreNotes.map(project, new Set([current.note.id, next.note.id]), (note) => {
      const copy = { ...note };
      if (isTied) {
        if (note.id === current.note.id) delete copy.tieTo;
        else delete copy.tieFrom;
      } else if (note.id === current.note.id) {
        copy.tieTo = next.note.id;
      } else {
        copy.tieFrom = current.note.id;
      }
      return copy;
    }, target.staff);
    return { ...updated, outline: ScoreTies.reconcile(updated.outline) };
  }

  export function place(project: ScoreProject, scope: VoiceScope, position: number, value: NoteValue, pitch: number): NoteTimeResult | undefined {
    const destination = { ...scope, position, noteId: null };
    return TupletNotes.context(project.outline, destination, position, false)
      ? TupletNotes.add(project, destination, position, pitch) : NotePlacement.add(project, scope, position, value, pitch);
  }
  export function after(project: ScoreProject, target: NoteTarget, value: NoteValue, tied: boolean): NoteTimeResult | undefined {
    const selected = NoteTargets.resolve(project, target);
    if (!selected || !selected.note.pitches.length || (tied && selected.note.tieTo)) return undefined;
    if (!tied && (selected.note.beforeGraceNotes?.length || selected.note.arpeggio) && value.type === '32nd') return undefined;
    const pitchIndex = target.pitchIndex !== null && selected.note.pitches[target.pitchIndex] ? target.pitchIndex : 0;
    const end = MusicalTime.addNumbers(MusicalTime.addNumbers(selected.measureStartSixteenths, selected.positionSixteenths), selected.lengthSixteenths);
    const result = place(project, target, end, value, selected.note.pitches[pitchIndex].midi);
    if (!result) return undefined;
    const nextId = result.noteId!;
    const nextProject = ScoreNotes.map(result.project, new Set(tied ? [selected.note.id, nextId] : [nextId]), note => {
      if (note.id === selected.note.id) return { ...note, tieTo: nextId };
      return {        
...note, pitches: selected.note.pitches.map(pitch => ({ ...pitch })),
        ...(tied ? { tieFrom: selected.note.id } : {
          ...(selected.note.arpeggio ? { arpeggio: { ...selected.note.arpeggio } } : {}),
          ...(selected.note.beforeGraceNotes?.length ? { beforeGraceNotes: selected.note.beforeGraceNotes.map(grace => ({ ...grace, id: 'grace-' + crypto.randomUUID(), value: { ...grace.value }, pitches: grace.pitches.map(pitch => ({ ...pitch })) })) } : {})
        })      
};
    }, target.staff);
    if (ScoreNotes.collides(project.outline, nextProject.outline, target.staff, new Set([nextId]))) return undefined;
    return { ...result, project: nextProject, pitchIndex, pitch: selected.note.pitches[pitchIndex].midi };
  }
}
export default NoteContinuation;
