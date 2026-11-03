import type { ScoreProject,PianoStaffName,KeySignature } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreNotes from './score-notes.ts';
import ScoreTies from './score-ties.ts';
import PianoPitchRules from './piano-pitch-rules.ts';
export type PitchTarget={ noteId: string; staff: PianoStaffName; pitchIndex: number };
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
    const ids=new Set(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).map(({ note }) => note.id));
    const nextProject=ScoreNotes.map(project,ids,(note) => ({
      ...note,pitches: note.pitches.map((pitch,index) => index===target.pitchIndex? { ...pitch,midi }:pitch).sort((a,b) => b.midi-a.midi),
    }),target.staff);
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
    const pitches=[...located.note.pitches,{ midi }].sort((a,b) => b.midi-a.midi);
    if(!PianoPitchRules.allowsChord(pitches.map((pitch) => pitch.midi))) return undefined;
    const ids=new Set(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).map(({ note }) => note.id));
    const nextProject=ScoreNotes.map(project,ids,(note) => ({ ...note,pitches: [...note.pitches,{ midi }].sort((a,b) => b.midi-a.midi) }),target.staff);
    if(ScoreNotes.collides(project.outline,nextProject.outline,target.staff,ids)) return undefined;
    return {
      project: nextProject,
      midi,pitchIndex: pitches.findIndex((pitch) => pitch.midi===midi),
    };
  }

  export function transpose(project: ScoreProject,staff: PianoStaffName,noteIds: readonly string[],direction: -1|1): ScoreProject|undefined {
    const ids=new Set(noteIds),selected=ScoreTimeline.allNotes(project.outline,staff).filter(entry => ids.has(entry.note.id));
    if(selected.length<2||selected.length!==ids.size||selected.some(({ note }) => note.pitches.some(({ midi }) => midi+direction<PianoPitchRules.min||midi+direction>PianoPitchRules.max))) return undefined;
    const next=ScoreNotes.map(project,ids,note => ({ ...note,pitches: note.pitches.map(pitch => ({ ...pitch,midi: pitch.midi+direction })) }),staff);
    if(ScoreNotes.collides(project.outline,next.outline,staff,ids)) return undefined;
    return { ...next,outline: ScoreTies.reconcile(next.outline) };
  }
}
export default NotePitches;
