import type { ScoreProject, PianoGraceNote, KeySignature } from './types.ts';
import type { NoteTarget } from './note-target.ts';
import NoteTargets from './note-target.ts';
import ScoreNotes from './score-notes.ts';
import PianoPitchRules from './piano-pitch-rules.ts';
import PitchSpelling from '../theory/pitch-spelling.ts';
import ScoreKey from './score-key.ts';
namespace GraceNotes {
  export function find(project: ScoreProject, target: NoteTarget, graceId: string | null) {
    const parent = NoteTargets.resolve(project, target);
    const grace = parent?.note.beforeGraceNotes?.find(grace => grace.id === graceId);
    return parent && grace ? { parent, grace } : undefined;
  }
  export function add(project: ScoreProject, target: NoteTarget, afterId: string | null) {
    const parent = NoteTargets.resolve(project, target);
    if (!parent || parent.note.pitches.length !== 1 || parent.note.value.type === '32nd') return undefined;
    const graces = parent.note.beforeGraceNotes ?? [];
    const selected = graces.findIndex(grace => grace.id === afterId);
    const pitch = (graces[selected]?.pitches[0].midi ?? parent.note.pitches[0].midi) - 1;
    if (pitch < PianoPitchRules.min) return undefined;
    const spellingDirection=PitchSpelling.directionForMove(pitch,ScoreKey.forBlock(project.outline,parent.measure.id),'down');
    const grace: PianoGraceNote = { id: 'grace-' + crypto.randomUUID(), pitches: [{ midi: pitch,...(spellingDirection?{ spellingDirection}:{}) }], value: { type: 'eighth', dots: 0 }, slash: true };
    const beforeGraceNotes = [...graces];
    beforeGraceNotes.splice(selected < 0 ? beforeGraceNotes.length : selected + 1, 0, grace);
    return { project: ScoreNotes.map(project, new Set([target.noteId]), note => ({ ...note, beforeGraceNotes }), target.staff), graceId: grace.id, pitch };
  }
  export function movePitch(project: ScoreProject, target: NoteTarget, graceId: string, direction: -1 | 1, key?: KeySignature, octave = false) {
    const selected = find(project, target, graceId);
    if (!selected) return undefined;
    const previous = selected.grace.pitches[0].midi;
    const pitch = octave ? previous + direction * 12 : PianoPitchRules.next(previous, direction, key);
    if (pitch === undefined || pitch < PianoPitchRules.min || pitch > PianoPitchRules.max || pitch === previous) return undefined;
    const spellingDirection=key===undefined&&!octave ? PitchSpelling.directionForMove(pitch,ScoreKey.forBlock(project.outline,selected.parent.measure.id),direction===1?'up':'down') : undefined;
    const beforeGraceNotes = selected.parent.note.beforeGraceNotes!.map(grace => {
      if(grace.id!==graceId) return grace;
      const { spellingDirection: _old, ...base }=grace.pitches[0];
      return { ...grace, pitches: [{ ...base, midi: pitch,...(octave ? grace.pitches[0].spellingDirection===undefined?{}:{ spellingDirection:grace.pitches[0].spellingDirection } : spellingDirection?{ spellingDirection}:{}) }] };
    });
    return { project: ScoreNotes.map(project, new Set([target.noteId]), note => ({ ...note, beforeGraceNotes }), target.staff), pitch };
  }
  export function remove(project: ScoreProject, target: NoteTarget, graceId: string) {
    const selected = find(project, target, graceId);
    if (!selected) return undefined;
    return ScoreNotes.map(project, new Set([target.noteId]), note => {
      const next = { ...note }, remaining = note.beforeGraceNotes!.filter(grace => grace.id !== graceId);
      if (remaining.length) next.beforeGraceNotes = remaining;
      else {
        delete next.beforeGraceNotes;
        delete next.gracePerformance;
      }
      return next;
    }, target.staff);
  }
}
export default GraceNotes;
