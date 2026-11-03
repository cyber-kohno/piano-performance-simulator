import NoteTargets from './note-target.ts';
import type { ScoreProject,PianoNote,NoteValue } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreVoice from './score-voice.ts';
import ScoreNotes from './score-notes.ts';

import WrittenValue from '../theory/written-value.ts';

import NotationGrid from './notation-grid.ts';

import type { NoteTarget,NoteTimeResult } from './note-target.ts';
import NoteSpan from './note-span.ts';
import RhythmSpelling from './rhythm-spelling.ts';
namespace NoteDuration {
  export function setValue(
    project: ScoreProject,target: NoteTarget,value: NoteValue,
  ): NoteTimeResult|undefined {
    if(!NoteTargets.resolve(project,target)) return undefined;
    const staff=target.staff;
    if(!Number.isInteger(value.dots)||value.dots<0) return undefined;
    const length=WrittenValue.sixteenths(value);
    // Dotted thirty-seconds do not fit the current editing grid.
    if(!NotationGrid.contains(length)||length<0.5) return undefined;
    const chain=ScoreTimeline.tieChain(project.outline,target.noteId,target.staff);
    const index=chain.findIndex(({ note }) => note.id===target.noteId);
    if(index<0) return undefined;
    const selected=chain[index];
    if((selected.note.beforeGraceNotes?.length||selected.note.arpeggio)&&value.type==='32nd') return undefined;
    if(selected.note.value.type===value.type&&selected.note.value.dots===value.dots) return undefined;
    const suffix=chain.slice(index);
    // Incoming tuplets keep their spelling and timing; only this note and its successors move.
    if(suffix.some((entry) => entry.tuplet)) return undefined;
    const start=selected.measureStartSixteenths+selected.positionSixteenths;
    const tail=suffix[suffix.length-1];
    const oldEnd=tail.measureStartSixteenths+tail.positionSixteenths+tail.lengthSixteenths;
    const plans: NoteSpan.NotePlan[]=[];
    let nextStart=start;
    for(const entry of suffix) {
      const nextValue=entry.note.id===selected.note.id? value:entry.note.value;
      const nextLength=WrittenValue.sixteenths(nextValue);
      const location=ScoreTimeline.measureAt(project.outline,nextStart);
      if(!location||!location.measure.data[staff].voices[target.voiceIndex]) return undefined;
      const position=nextStart-location.startSixteenths;
      // Explicit note values are never split automatically at a barline.
      if(position+nextLength>location.lengthSixteenths) return undefined;
      plans.push({ measureId: location.measure.id,position,note: { ...entry.note,value: { ...nextValue } } });
      nextStart+=nextLength;
    }
    const affectedIds=new Set(suffix.map(({ note }) => note.id));
    const end=Math.max(oldEnd,nextStart);
    if(NoteSpan.hasTuplet(project.outline,target,start,end)) return undefined;
    if(ScoreTimeline.notes(project.outline,target.staff,target.voiceIndex).some((entry) => {
      if(affectedIds.has(entry.note.id)) return false;
      const onset=entry.measureStartSixteenths+entry.positionSixteenths;
      return onset<end&&onset+entry.lengthSixteenths>start;
    })) return undefined;

    const nextProject=NoteSpan.rewrite(project,start,end,plans,target.staff,target.voiceIndex);
    if(ScoreNotes.collides(project.outline,nextProject.outline,target.staff,affectedIds)) return undefined;
    return {
      project: nextProject,
      position: start,
    };
  }

  const SINGLE_NOTE_VALUES: NoteValue[]=[
    { type: '32nd',dots: 0 },{ type: '16th',dots: 0 },{ type: '16th',dots: 1 },
    { type: 'eighth',dots: 0 },{ type: 'eighth',dots: 1 },
    { type: 'quarter',dots: 0 },{ type: 'quarter',dots: 1 },
    { type: 'half',dots: 0 },{ type: 'half',dots: 1 },{ type: 'whole',dots: 0 },
  ];

  /** Search input-unit increments for the next representable single written value. */
  export function resize(project: ScoreProject,target: NoteTarget,step: number,direction: -1|1) {
    const selected=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    if(!selected||!NotationGrid.contains(step)||step<0.5) return undefined;
    const length=selected.lengthSixteenths;
    const candidates=direction===1? SINGLE_NOTE_VALUES:[...SINGLE_NOTE_VALUES].reverse();
    const value=candidates.find((value) => {
      const difference=(WrittenValue.sixteenths(value)-length)*direction;
      return difference>0&&difference%step===0;
    });
    return value? setValue(project,target,value):undefined;
  }

  export function normalize(
    project: ScoreProject,target: NoteTarget,direction: -1|0|1,unit: number,
  ): NoteTimeResult|undefined {
    const staff=target.staff;
    const chain=ScoreTimeline.tieChain(project.outline,target.noteId,target.staff);
    if(chain.some((entry) => entry.tuplet)) return undefined;
    if(!chain.length) return undefined;
    const first=chain[0];
    const last=chain[chain.length-1];
    const start=first.measureStartSixteenths+first.positionSixteenths;
    const oldEnd=last.measureStartSixteenths+last.positionSixteenths+last.lengthSixteenths;
    const step=direction===0? 1:unit;
    const newEnd=oldEnd+direction*step;
    if(chain.some(entry => (entry.note.beforeGraceNotes?.length||entry.note.arpeggio)&&
      entry.measureStartSixteenths+entry.positionSixteenths>=newEnd)) return undefined;
    if(NoteSpan.hasTuplet(project.outline,target,start,Math.max(oldEnd,newEnd))) return undefined;
    const limit=ScoreTimeline.length(project.outline);
    if(!NotationGrid.contains(step)||step<0.5||newEnd<=start||newEnd>limit) return undefined;
    const samePitchNames=(a: PianoNote['pitches'],b: PianoNote['pitches']) =>
      a.length===b.length&&a.every((pitch,index) => pitch.midi===b[index].midi);
    const samePitches=(a: PianoNote['pitches'],b: PianoNote['pitches']) =>
      samePitchNames(a,b)&&a.every((pitch,index) => pitch.fingering===b[index].fingering);
    let expected=start;
    for(const entry of chain) {
      const length=entry.lengthSixteenths;
      if(!entry.note.pitches.length||!NotationGrid.contains(length)||length<0.5||
        entry.measureStartSixteenths+entry.positionSixteenths!==expected||
        !samePitchNames(first.note.pitches,entry.note.pitches)) return undefined;
      expected+=length;
    }
    const ids=new Set(chain.map(({ note }) => note.id));
    if(ScoreTimeline.notes(project.outline,target.staff,target.voiceIndex).some((entry) => {
      const onset=entry.measureStartSixteenths+entry.positionSixteenths;
      return !ids.has(entry.note.id)&&onset<newEnd&&onset+entry.lengthSixteenths>start;
    })) return undefined;

    // Preserve finger changes as boundaries that normalization cannot merge across.
    const groups: { start: number; pitches: PianoNote['pitches'] }[]=[];
    for(const entry of chain) {
      const previousId=chain[chain.indexOf(entry)-1]?.note.id;
      const slurBoundary=project.slurs?.some(slur => slur.startNoteId===entry.note.id||slur.endNoteId===entry.note.id||slur.endNoteId===previousId);
      if(!groups.length||slurBoundary||project.tempoChanges?.some(change => change.noteId===entry.note.id)||project.clefChanges?.some(change => change.noteId===entry.note.id)||entry.note.staccato||entry.note.arpeggio||entry.note.beforeGraceNotes?.length||!samePitches(groups[groups.length-1].pitches,entry.note.pitches)) {
        groups.push({ start: entry.measureStartSixteenths+entry.positionSixteenths,pitches: entry.note.pitches });
      }
    }
    const usedIds=new Set(project.outline.flatMap((block) => block.type!=='measure'? []:
      [block.data.upperStaff,block.data.lowerStaff].flatMap((staff) => staff.voices.flatMap((voice) => ScoreVoice.flatten(voice,block.data.length).map(({ element }) => element.id))),
    ));
    let number=1;
    const plans: (NoteSpan.NotePlan&{ onset: number })[]=[];
    for(let index=0;index<groups.length;index+=1) {
      const group=groups[index];
      const end=Math.min(newEnd,groups[index+1]?.start??newEnd);
      let onset=group.start;
      while(onset<end) {
        const location=ScoreTimeline.measureAt(project.outline,onset);
        if(!location||!location.measure.data[staff].voices[target.voiceIndex]) return undefined;
        const stop=Math.min(end,location.startSixteenths+location.lengthSixteenths);
        const values=RhythmSpelling.spell(onset-location.startSixteenths,stop-onset,project.outline[0].data.timeSignature);
        if(!values) return undefined;
        for(const value of values) {
          const previous=chain.find((entry) => entry.measureStartSixteenths+entry.positionSixteenths===onset&&samePitches(entry.note.pitches,group.pitches));
          while(usedIds.has(`note-${number}`)) number+=1;
          const id=previous?.note.id??`note-${number++}`;
          usedIds.add(id);
          if((previous?.note.beforeGraceNotes?.length||previous?.note.arpeggio)&&value.type==='32nd') return undefined;
          plans.push({
            measureId: location.measure.id,position: onset-location.startSixteenths,onset,
            note: {
              id,kind: 'note',value: { ...value },pitches: group.pitches.map((pitch) => ({ ...pitch })),
              ...(previous?.note.beforeGraceNotes?.length? { beforeGraceNotes: previous.note.beforeGraceNotes }:{}),
              ...(previous?.note.arpeggio? { arpeggio: { ...previous.note.arpeggio } }:{}),
              ...(previous?.note.staccato? { staccato: { ...previous.note.staccato } }:{})
            },
          });
          onset+=WrittenValue.sixteenths(value);
        }
      }
    }
    plans.forEach((plan,index) => {
      if(index>0) plan.note.tieFrom=plans[index-1].note.id;
      if(index+1<plans.length) plan.note.tieTo=plans[index+1].note.id;
    });
    const selected=chain.find(({ note }) => note.id===target.noteId)!;
    const selectedOnset=selected.measureStartSixteenths+selected.positionSixteenths;
    const tail=direction===0
      ? plans.find((plan) => plan.onset<=selectedOnset&&selectedOnset<plan.onset+WrittenValue.sixteenths(plan.note.value))!
      :plans[plans.length-1];
    const pitchIndex=target.pitchIndex!==null&&tail.note.pitches[target.pitchIndex]
      ? target.pitchIndex:0;
    const nextProject=NoteSpan.rewrite(project,start,Math.max(oldEnd,newEnd),plans,target.staff,target.voiceIndex);
    if(ScoreNotes.collides(project.outline,nextProject.outline,target.staff,new Set(plans.map(({ note }) => note.id)))) return undefined;
    return {
      project: nextProject,
      position: tail.onset,noteId: tail.note.id,pitchIndex,pitch: tail.note.pitches[pitchIndex].midi,
    };
  }

}
export default NoteDuration;
