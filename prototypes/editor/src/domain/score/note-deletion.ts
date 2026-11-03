import NoteTargets from './note-target.ts';
import type { ScoreProject,PianoStaffName,PianoVoiceElement } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreVoice from './score-voice.ts';
import ScoreNotes from './score-notes.ts';
import ScoreTies from './score-ties.ts';

import MusicalTime from '../theory/musical-time.ts';

import RestSpelling from './rest-spelling.ts';
import type { NoteTarget,NoteTimeResult } from './note-target.ts';
namespace NoteDeletion {
  function restoreEmptyDeletedTuplets(
    previous: ScoreProject,next: ScoreProject,staff: PianoStaffName,deletedIds: ReadonlySet<string>,replacementPosition: number,
  ) {
    const affectedGroups=new Set(previous.outline.flatMap((block) => block.type!=='measure'? []:
      block.data[staff].voices.flatMap((voice) => voice.elements.flatMap((element) =>
        element.kind==='tuplet'&&element.elements.some((child) => child.kind==='note'&&deletedIds.has(child.id))? [element.id]:[],
      )),
    ));
    let measureStart=0;
    const outline=next.outline.map((block) => {
      if(block.type!=='measure') return block;
      const offset=measureStart;
      measureStart+=block.data.length.cnt/block.data.length.unit*16;
      return {
        ...block,data: {
          ...block.data,[staff]: {
            ...block.data[staff],voices: block.data[staff].voices.map((voice) => ({
              ...voice,elements: ScoreVoice.locate(voice,block.data.length).flatMap((entry): PianoVoiceElement[] => {
                if(entry.element.kind!=='tuplet'||!affectedGroups.has(entry.element.id)||entry.element.elements.some((child) => child.kind==='note')) return [entry.element];
                const start=MusicalTime.addNumbers(offset,entry.positionSixteenths);
                const end=MusicalTime.addNumbers(start,entry.lengthSixteenths);
                if(MusicalTime.compareNumbers(replacementPosition,start)>=0&&MusicalTime.compareNumbers(replacementPosition,end)<0) replacementPosition=start;
                return RestSpelling.create(entry.positionSixteenths,entry.lengthSixteenths);
              }),
            }))
          }
        }
      };
    }) as ScoreProject['outline'];
    return { project: { ...next,outline: ScoreTies.reconcile(outline) },positionSixteenths: replacementPosition };
  }

  export function remove(project: ScoreProject,target: NoteTarget,noteIds: readonly string[],pitchOnly=false): NoteTimeResult|undefined {
    if(!NoteTargets.resolve(project,target)) return undefined;
    const requested=new Set(noteIds);
    if(requested.size>0&&!requested.has(target.noteId)) return undefined;
    const selection=ScoreTimeline.notes(project.outline,target.staff,target.voiceIndex).filter(entry => requested.has(entry.note.id));
    if(requested.size>0&&selection.length!==requested.size) return undefined;
    if(selection.length>1) {
      if(pitchOnly) return undefined;
      const ids=new Set(selection.map(({ note }) => note.id));
      const next=ScoreNotes.map(project,ids,(note) => ({ id: RestSpelling.createId(),kind: 'rest',value: { ...note.value } }),target.staff);
      const restored=restoreEmptyDeletedTuplets(project,next,target.staff,ids,selection[0].measureStartSixteenths+selection[0].positionSixteenths);
      return {
        project: restored.project,
        position: restored.positionSixteenths,
      };
    }
    const located=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    if(!located) return undefined;
    const index=target.pitchIndex;
    if(pitchOnly&&(index===null||!located.note.pitches[index])) return undefined;
    const pitches=pitchOnly? located.note.pitches.filter((_,pitchIndex) => pitchIndex!==index):[];
    if(pitches.length===1&&ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).some(entry => entry.note.arpeggio)) return undefined;
    const targets=pitchOnly
      ? new Set(ScoreTimeline.tieChain(project.outline,located.note.id,target.staff).map(({ note }) => note.id))
      :new Set([located.note.id]);
    const nextProject=ScoreNotes.map(project,targets,(note) => pitches.length===0
      ? { id: RestSpelling.createId(),kind: 'rest',value: { ...note.value } }
      :{ ...note,pitches: note.pitches.filter((_,pitchIndex) => pitchIndex!==index) },target.staff);
    const nextIndex=Math.min(index??0,pitches.length-1);
    const restored=restoreEmptyDeletedTuplets(project,nextProject,target.staff,targets,located.measureStartSixteenths+located.positionSixteenths);
    return {
      project: restored.project,
      position: restored.positionSixteenths,
      ...(pitches.length>0? { noteId: located.note.id,pitchIndex: nextIndex,pitch: pitches[nextIndex].midi }:{}),
    };
  }

}
export default NoteDeletion;
