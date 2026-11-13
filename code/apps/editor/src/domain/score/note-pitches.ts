import type { ScoreProject,PianoStaffName,KeySignature,PianoFingering } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreNotes from './score-notes.ts';
import ScoreTies from './score-ties.ts';
import PianoPitchRules from './piano-pitch-rules.ts';
import PitchSpelling from '../theory/pitch-spelling.ts';
import ScoreKey from './score-key.ts';
import ScoreFingerings from './score-fingerings.ts';
import ScoreTrill from './score-trill.ts';
export type PitchTarget={ noteId: string; staff: PianoStaffName; pitchIndex: number };
export type FingeringTarget = PitchTarget & { graceNoteId?: string };
export type PitchEditResult={ project: ScoreProject; midi: number; pitchIndex: number };
namespace NotePitches {
  export function move(
    project: ScoreProject,target: PitchTarget,direction: -1|1,keySignature?: KeySignature,octave=false,
  ): PitchEditResult|undefined {
    const located=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    const selected=located?.note.pitches[target.pitchIndex];
    if(!located||!selected) return undefined;
    const midi=octave? selected.midi+direction*12
      :PianoPitchRules.next(selected.midi,direction,keySignature,new Set(located.note.pitches.map((pitch) => pitch.midi)));
    if(midi===undefined) return undefined;
    if(midi<PianoPitchRules.min||midi>PianoPitchRules.max||
      located.note.pitches.some((pitch,index) => index!==target.pitchIndex&&pitch.midi===midi)) return undefined;
    if(!PianoPitchRules.allowsChord(located.note.pitches.map((pitch,index) =>
      index===target.pitchIndex? midi:pitch.midi,
    ))) return undefined;
    const measureKey=ScoreKey.forBlock(project.outline,located.measure.id);
    const spellingDirection=keySignature===undefined&&!octave
      ? PitchSpelling.directionForMove(midi,measureKey,direction===1?'up':'down') : undefined;
    const ids=new Set(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).map(({ note }) => note.id));
    const nextProject=ScoreNotes.map(project,ids,(note) => ({
      ...note,pitches: note.pitches.map((pitch,index) => {
        if(index!==target.pitchIndex) return pitch;
        const { spellingDirection: _old, ...base }=pitch;
        return { ...base,midi,...(octave ? pitch.spellingDirection === undefined ? {} : { spellingDirection: pitch.spellingDirection } : spellingDirection ? { spellingDirection } : {}) };
      }).sort((a,b) => b.midi-a.midi),
    }),target.staff);
    ScoreTimeline.inheritTiming(project.outline, nextProject.outline);
    if(ScoreNotes.collides(project.outline,nextProject.outline,target.staff,ids)) return undefined;
    return {
      project: nextProject,
      midi,pitchIndex: located.note.pitches.filter((pitch,index) => index!==target.pitchIndex&&pitch.midi>midi).length,
    };
  }
  export function add(project: ScoreProject,target: PitchTarget): PitchEditResult|undefined {
    const located=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    const selected=located?.note.pitches[target.pitchIndex];
    if(!located||!selected) return undefined;
    if(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).some(entry => entry.note.beforeGraceNotes?.length)) return undefined;
    const midi=selected.midi-1;
    if(midi<PianoPitchRules.min||located.note.pitches.some((pitch) => pitch.midi===midi)) return undefined;
    const spellingDirection=PitchSpelling.directionForMove(midi,ScoreKey.forBlock(project.outline,located.measure.id),'down');
    const pitches=[...located.note.pitches,{ midi,...(spellingDirection?{ spellingDirection}:{}) }].sort((a,b) => b.midi-a.midi);
    if(!PianoPitchRules.allowsChord(pitches.map((pitch) => pitch.midi))) return undefined;
    const ids=new Set(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).map(({ note }) => note.id));
    const nextProject=ScoreNotes.map(project,ids,(note) => ({ ...note,pitches: [...note.pitches,{ midi,...(spellingDirection?{ spellingDirection}:{}) }].sort((a,b) => b.midi-a.midi) }),target.staff);
    if(ScoreNotes.collides(project.outline,nextProject.outline,target.staff,ids)) return undefined;
    return {
      project: nextProject,
      midi,pitchIndex: pitches.findIndex((pitch) => pitch.midi===midi),
    };
  }

  export function setFingering(project: ScoreProject,target: FingeringTarget,fingering: PianoFingering | null,
    substitutionFingering?: PianoFingering): ScoreProject {
    if(!target.graceNoteId && ScoreTrill.forNote(project,target.noteId)) return project;
    const located=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    const pitches = target.graceNoteId === undefined ? located?.note.pitches
      : located?.note.beforeGraceNotes?.find(grace => grace.id === target.graceNoteId)?.pitches;
    const current=pitches?.[target.pitchIndex];
    if(!located||!pitches||!current) return project;
    if (fingering !== null && !ScoreFingerings.allows(
      ScoreFingerings.rules(located.note, target.pitchIndex, target.graceNoteId), fingering, substitutionFingering,
    )) return project;
    if (fingering === null ? current.fingering === undefined && current.substitutionFingering === undefined
      : current.fingering===fingering&&current.substitutionFingering===substitutionFingering) return project;
    const updatedPitches = pitches.map((pitch,index) => {
      if(index!==target.pitchIndex) return pitch;
      const { fingering: _previous, substitutionFingering: _previousSubstitution, ...base }=pitch;
      return { ...base, ...(fingering === null ? {} : { fingering,
        ...(substitutionFingering === undefined ? {} : { substitutionFingering }) }) };
    });
    return ScoreNotes.map(project,new Set([target.noteId]),note => ({
      ...note,
      ...(target.graceNoteId === undefined ? { pitches: updatedPitches }
        : { beforeGraceNotes: note.beforeGraceNotes!.map(grace =>
          grace.id === target.graceNoteId ? { ...grace, pitches: updatedPitches } : grace) }),
    }),target.staff);
  }

  export function setSpellingDirection(project: ScoreProject,target: PitchTarget,direction?: 'up'|'down'): ScoreProject {
    const located=ScoreTimeline.note(project.outline,target.noteId,target.staff), pitch=located?.note.pitches[target.pitchIndex];
    if(!located||!pitch||pitch.spellingDirection===direction) return project;
    return ScoreNotes.map(project,new Set([target.noteId]),note => ({ ...note,pitches: note.pitches.map((entry,index) => {
      if(index!==target.pitchIndex) return entry;
      const { spellingDirection: _old,...base }=entry;
      return { ...base,...(direction?{ spellingDirection:direction}:{}) };
    }) }),target.staff);
  }

  export function transpose(project: ScoreProject,staff: PianoStaffName,noteIds: readonly string[],direction: -1|1,octave=false): ScoreProject|undefined {
    const ids=new Set(noteIds),selected=ScoreTimeline.allNotes(project.outline,staff).filter(entry => ids.has(entry.note.id));
    const interval=direction*(octave?12:1);
    if(selected.length<2||selected.length!==ids.size||selected.some(({ note }) => note.pitches.some(({ midi }) => midi+interval<PianoPitchRules.min||midi+interval>PianoPitchRules.max))) return undefined;
    const keyByNote=new Map(selected.map(({ note, measure }) => [note.id,ScoreKey.forBlock(project.outline,measure.id)]));
    const next=ScoreNotes.map(project,ids,note => ({ ...note,pitches: note.pitches.map(pitch => {
      const midi=pitch.midi+interval;
      if(octave) return { ...pitch,midi };
      const { spellingDirection: _old, ...base }=pitch;
      const spellingDirection=PitchSpelling.directionForMove(midi,keyByNote.get(note.id)!,direction===1?'up':'down');
      return { ...base,midi,...(spellingDirection?{ spellingDirection}:{}) };
    }) }),staff);
    if (ScoreTimeline.isPrepared(project.outline)) ScoreTimeline.prepare(next.outline);
    if(ScoreNotes.collides(project.outline,next.outline,staff,ids)) return undefined;
    return { ...next,outline: ScoreTies.reconcile(next.outline) };
  }
}
export default NotePitches;
