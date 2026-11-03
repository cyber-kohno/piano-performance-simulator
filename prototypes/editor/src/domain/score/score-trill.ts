import type { ScoreProject, PianoNote, PianoStaffName, TrillSettings, TrillSpan, KeySignature } from './types.ts';
import ScoreVoice from './score-voice.ts';

namespace ScoreTrill {
  export const defaults: TrillSettings = { auxiliary:'diatonic', start:'main', attackCount:8 };
  export function validate(settings: TrillSettings): boolean {
    return ['diatonic','half','whole'].includes(settings.auxiliary) && ['main','auxiliary'].includes(settings.start) &&
      Number.isInteger(settings.attackCount) && settings.attackCount >= 2 && settings.attackCount <= 128;
  }
  export function notes(project: ScoreProject) {
    return project.outline.flatMap(block => block.type !== 'measure' ? [] :
      (['upperStaff','lowerStaff'] as PianoStaffName[]).flatMap(staff => block.data[staff].voices.flatMap((voice,voiceIndex) =>
        ScoreVoice.flatten(voice,block.data.length).flatMap(entry => entry.element.kind === 'note'
          ? [{note:entry.element,staff,voiceIndex}] : []))));
  }
  /** Scope references by IDs; never store onset or duration in a range expression. */
  export function chain(project: ScoreProject, noteId: string): PianoNote[] {
    const notes=ScoreTrill.notes(project), selected=notes.find(entry=>entry.note.id===noteId);
    if (!selected) return [];
    const byId=new Map(notes.filter(entry=>entry.staff===selected.staff && entry.voiceIndex===selected.voiceIndex).map(entry=>[entry.note.id,entry.note]));
    let head=selected.note; const seen=new Set<string>();
    while(head.tieFrom) {
      if(seen.has(head.id)) return [];
      seen.add(head.id); const previous=byId.get(head.tieFrom);
      if(!previous || previous.tieTo!==head.id) return [];
      head=previous;
    }
    const result:PianoNote[]=[];seen.clear();
    for(let note:PianoNote|undefined=head;note;) {
      if(seen.has(note.id)) return [];
      seen.add(note.id);result.push(note);
      if(!note.tieTo) break;
      const next=byId.get(note.tieTo);
      if(!next || next.tieFrom!==note.id) return [];
      note=next;
    }
    return result;
  }
  export function forNote(project: ScoreProject, noteId: string): TrillSpan | undefined {
    const chain=ScoreTrill.chain(project,noteId);
    return project.trills?.find(span=>span.startNoteId===chain[0]?.id && span.endNoteId===chain.at(-1)?.id);
  }
  export function canApply(project: ScoreProject, noteId: string): boolean {
    const chain=ScoreTrill.chain(project,noteId);
    return chain.length>0 && chain.every(note=>note.pitches.length===1 && note.pitches[0].midi===chain[0].pitches[0].midi);
  }
  export function set(project: ScoreProject, noteId: string, settings: TrillSettings | undefined): ScoreProject {
    if(settings && (!ScoreTrill.validate(settings) || !ScoreTrill.canApply(project,noteId))) return project;
    const existing=ScoreTrill.forNote(project,noteId), chain=ScoreTrill.chain(project,noteId);
    if(!chain.length) return project;
    const trills=(project.trills ?? []).filter(span=>span.id!==existing?.id);
    if(settings) trills.push({id:existing?.id ?? `trill-${crypto.randomUUID()}`,kind:'trill',startNoteId:chain[0].id,endNoteId:chain.at(-1)!.id,settings:{...settings}});
    const {trills:_,...rest}=project;
    return trills.length ? {...rest,trills} : rest;
  }
  /** One transaction boundary for all editor commands. Only explicit normalization may remap membership. */
  export function reconcile(before: ScoreProject, after: ScoreProject,
    normalized?: {oldNoteId:string;newNoteId:string}): ScoreProject {
    if(!after.trills?.length) return after;
    const trills=after.trills.flatMap(span=>{
      const old=(before.trills ?? []).find(item=>item.id===span.id);
      if(!old) return ScoreTrill.validate(span.settings) && ScoreTrill.canApply(after,span.startNoteId) &&
        ScoreTrill.chain(after,span.startNoteId)[0]?.id===span.startNoteId &&
        ScoreTrill.chain(after,span.startNoteId).at(-1)?.id===span.endNoteId ? [span] : [];
      const previous=ScoreTrill.chain(before,old.startNoteId);
      const remap=normalized && previous.some(note=>note.id===normalized.oldNoteId);
      const next=ScoreTrill.chain(after,remap ? normalized.newNoteId : span.startNoteId);
      if(!next.length || !ScoreTrill.canApply(after,next[0].id)) return [];
      if(remap) return [{...span,startNoteId:next[0].id,endNoteId:next.at(-1)!.id}];
      // Uncertain edits remove the expression. Translation retains IDs, pitches and written values.
      if(previous.length!==next.length || previous.some((note,index)=>note.id!==next[index].id ||
        JSON.stringify(note.value)!==JSON.stringify(next[index].value) ||
        note.pitches[0].midi!==next[index].pitches[0].midi) || span.endNoteId!==next.at(-1)!.id) return [];
      return [span];
    });
    const {trills:_,...rest}=after;
    return trills.length ? {...rest,trills} : rest;
  }
}
export default ScoreTrill;
