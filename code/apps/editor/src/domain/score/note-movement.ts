import NoteTargets from './note-target.ts';
import type { ScoreProject,PianoNote,PianoVoiceElement } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreVoice from './score-voice.ts';
import ScoreNotes from './score-notes.ts';
import ScoreTies from './score-ties.ts';
import WrittenValue from '../theory/written-value.ts';
import MusicalTime from '../theory/musical-time.ts';
import NotationGrid from './notation-grid.ts';
import RestSpelling from './rest-spelling.ts';
import type { NoteTarget,NoteTimeResult } from './note-target.ts';
import NoteSpan from './note-span.ts';
import NoteOrder from './note-order.ts';
namespace NoteMovement {
  export function move(project: ScoreProject,target: NoteTarget,noteIds: readonly string[],shift: number): NoteTimeResult|undefined {
    if(!NoteTargets.resolve(project,target)) return undefined;
    const staff=target.staff;
    const requested=new Set(noteIds);
    if(requested.size>0&&!requested.has(target.noteId)) return undefined;
    const selection=ScoreTimeline.isPrepared(project.outline) ? [...requested].flatMap(id => {
      const entry=ScoreTimeline.note(project.outline,id,target.staff);
      return entry?.voiceIndex===target.voiceIndex ? [entry] : [];
    }).sort((a,b) => a.measureStartSixteenths+a.positionSixteenths-b.measureStartSixteenths-b.positionSixteenths)
      : ScoreTimeline.notes(project.outline,target.staff,target.voiceIndex).filter(entry => requested.has(entry.note.id));
    if(requested.size>0&&selection.length!==requested.size) return undefined;
    const chain=selection.length>1? selection:ScoreTimeline.tieChain(project.outline,target.noteId,target.staff);
    if(selection.some(entry => entry.tuplet)) return undefined;
    if(chain.some((entry) => entry.tuplet)) return undefined;
    if(!chain.length) return undefined;
    if(!NotationGrid.contains(shift)||shift===0) return undefined;
    const ids=new Set(chain.map(({ note }) => note.id));
    const plans: { measureId: string; position: number; onset: number; note: PianoNote }[]=[];
    const moving=chain.map(entry => ({ start: MusicalTime.addNumbers(entry.measureStartSixteenths,entry.positionSixteenths),length: entry.lengthSixteenths }));
    const start=MusicalTime.addNumbers(moving.reduce((start,note) => Math.min(start,note.start),Infinity),Math.min(shift,0));
    const end=MusicalTime.addNumbers(moving.reduce((end,note) => Math.max(end,MusicalTime.addNumbers(note.start,note.length)),-Infinity),Math.max(shift,0));
    const others=ScoreTimeline.notesInRange(project.outline,target.staff,target.voiceIndex,start,end).filter(({ note }) => !ids.has(note.id));
    if(NoteOrder.crosses(
      moving,
      others.map(entry => ({ start: MusicalTime.addNumbers(entry.measureStartSixteenths,entry.positionSixteenths),length: entry.lengthSixteenths })),shift,
    )) return undefined;
    for(const entry of chain) {
      const onset=entry.measureStartSixteenths+entry.positionSixteenths+shift;
      const length=entry.lengthSixteenths;
      if(NoteSpan.hasTuplet(project.outline,target,onset,MusicalTime.addNumbers(onset,length))) return undefined;
      const location=ScoreTimeline.measureAt(project.outline,onset);
      if(!location||!location.measure.data[staff].voices[target.voiceIndex]) return undefined;
      const position=onset-location.startSixteenths;
      if(!NotationGrid.contains(length)||position+length>location.lengthSixteenths) return undefined;
      if(others.some((other) => {
        const otherStart=other.measureStartSixteenths+other.positionSixteenths;
        return onset<otherStart+other.lengthSixteenths&&onset+length>otherStart;
      })) return undefined;
      plans.push({ measureId: location.measure.id,position,onset,note: entry.note });
    }

    const measures=new Set([...chain.map(entry => entry.measure.id),...plans.map(plan => plan.measureId)]);
    const outline=project.outline.map((block) => {
      if(block.type!=='measure') return block;
      if(!measures.has(block.id)) return block;
      const voice=block.data[staff].voices[target.voiceIndex];
      if(!voice) return block;
      const entries=ScoreVoice.locate(voice,block.data.length);
      const incoming=plans.filter((plan) => plan.measureId===block.id);
      const ranges=entries.filter(({ element }) => ids.has(element.id)).map(({ index }) => ({ first: index,last: index }));
      for(const plan of incoming) {
        const end=plan.position+WrittenValue.sixteenths(plan.note.value);
        const hit=entries.filter((entry) => entry.positionSixteenths<end&&entry.positionSixteenths+entry.lengthSixteenths>plan.position);
        ranges.push({ first: hit[0].index,last: hit[hit.length-1].index });
      }
      if(!ranges.length) return block;
      ranges.sort((a,b) => a.first-b.first);
      const merged: typeof ranges=[];
      for(const range of ranges) {
        const previous=merged[merged.length-1];
        if(previous&&range.first<=previous.last+1) previous.last=Math.max(previous.last,range.last);
        else merged.push({ ...range });
      }
      const elements: PianoVoiceElement[]=[];
      let nextIndex=0;
      for(const range of merged) {
        elements.push(...voice.elements.slice(nextIndex,range.first));
        const first=entries[range.first];
        const last=entries[range.last];
        const start=first.positionSixteenths;
        const end=last.positionSixteenths+last.lengthSixteenths;
        const notes=incoming.filter((plan) => plan.position>=start&&plan.position<end)
          .map((plan) => ({ position: plan.position,note: plan.note }));
        for(const entry of entries.slice(range.first,range.last+1)) {
          if(entry.element.kind==='note'&&!ids.has(entry.element.id)) notes.push({ position: entry.positionSixteenths,note: entry.element });
        }
        notes.sort((a,b) => a.position-b.position);
        let position=start;
        for(const entry of notes) {
          elements.push(...RestSpelling.create(position,entry.position-position),entry.note);
          position=entry.position+WrittenValue.sixteenths(entry.note.value);
        }
        elements.push(...RestSpelling.create(position,end-position));
        nextIndex=range.last+1;
      }
      elements.push(...voice.elements.slice(nextIndex));
      return {
        ...block,data: {
          ...block.data,[staff]: {
            ...block.data[staff],
            voices: block.data[staff].voices.map((voice,index) => index!==target.voiceIndex? voice:{ ...voice,elements }),
          }
        }
      };
    }) as ScoreProject['outline'];
    if(ScoreTimeline.isPrepared(project.outline)) ScoreTimeline.prepare(outline);
    const selected=plans.find(({ note }) => note.id===target.noteId)!;
    if(ScoreNotes.collides(project.outline,outline,staff,ids)) return undefined;
    return {
      project: ScoreTies.reconcileNotes({ ...project,outline },staff,ids),
      position: selected.onset,
    };
  }

}
export default NoteMovement;
