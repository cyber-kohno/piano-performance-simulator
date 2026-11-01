import { getFlattenedVoiceElements, type ScoreProject, type PianoNote, type PianoStaffName, type TrillSettings, type TrillSpan, type KeySignature } from './project.ts';
import { spellPreviewPitch } from './pitch-spelling.ts';

export const DEFAULT_TRILL: TrillSettings = { auxiliary:'diatonic', start:'main', attackCount:8 };
/** Auxiliary notation uses the next letter name above the main pitch. */
export function getTrillAuxiliary(main:number,key:KeySignature,mode:TrillSettings['auxiliary']) {
  const names=['C','D','E','F','G','A','B'], naturals=[0,2,4,5,7,9,11];
  const spelling=spellPreviewPitch(main,key), index=(names.indexOf(spelling.step)+1)%7;
  const octave=spelling.octave+(index===0?1:0), natural=(octave+1)*12+naturals[index];
  const order=key.fifths>=0 ? [3,0,4,1,5,2,6] : [6,2,5,1,4,0,3];
  const alter=mode==='diatonic' ? (order.slice(0,Math.abs(key.fifths)).includes(index) ? Math.sign(key.fifths) : 0)
    : main+(mode==='half'?1:2)-natural;
  return {midi:natural+alter,step:names[index],octave,alter};
}
export function isValidTrill(settings: TrillSettings): boolean {
  return ['diatonic','half','whole'].includes(settings.auxiliary) && ['main','auxiliary'].includes(settings.start) &&
    Number.isInteger(settings.attackCount) && settings.attackCount >= 2 && settings.attackCount <= 128;
}
export function getTrillNotes(project: ScoreProject) {
  return project.outline.flatMap(block => block.type !== 'measure' ? [] :
    (['upperStaff','lowerStaff'] as PianoStaffName[]).flatMap(staff => block.data[staff].voices.flatMap((voice,voiceIndex) =>
      getFlattenedVoiceElements(voice,block.data.length).flatMap(entry => entry.element.kind === 'note'
        ? [{note:entry.element,staff,voiceIndex}] : []))));
}
/** Scope references by IDs; never store onset or duration in a range expression. */
export function getTrillChain(project: ScoreProject, noteId: string): PianoNote[] {
  const notes=getTrillNotes(project), selected=notes.find(entry=>entry.note.id===noteId);
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
export function getNoteTrill(project: ScoreProject, noteId: string): TrillSpan | undefined {
  const chain=getTrillChain(project,noteId);
  return project.trills?.find(span=>span.startNoteId===chain[0]?.id && span.endNoteId===chain.at(-1)?.id);
}
export function canApplyTrill(project: ScoreProject, noteId: string): boolean {
  const chain=getTrillChain(project,noteId);
  return chain.length>0 && chain.every(note=>note.pitches.length===1 && note.pitches[0].midi===chain[0].pitches[0].midi);
}
export function setNoteTrill(project: ScoreProject, noteId: string, settings: TrillSettings | undefined): ScoreProject {
  if(settings && (!isValidTrill(settings) || !canApplyTrill(project,noteId))) return project;
  const existing=getNoteTrill(project,noteId), chain=getTrillChain(project,noteId);
  if(!chain.length) return project;
  const trills=(project.trills ?? []).filter(span=>span.id!==existing?.id);
  if(settings) trills.push({id:existing?.id ?? `trill-${crypto.randomUUID()}`,kind:'trill',startNoteId:chain[0].id,endNoteId:chain.at(-1)!.id,settings:{...settings}});
  const {trills:_,...rest}=project;
  return trills.length ? {...rest,trills} : rest;
}
/** One transaction boundary for all editor commands. Only explicit normalization may remap membership. */
export function reconcileTrills(before: ScoreProject, after: ScoreProject,
  normalized?: {oldNoteId:string;newNoteId:string}): ScoreProject {
  if(!after.trills?.length) return after;
  const trills=after.trills.flatMap(span=>{
    const old=(before.trills ?? []).find(item=>item.id===span.id);
    if(!old) return isValidTrill(span.settings) && canApplyTrill(after,span.startNoteId) &&
      getTrillChain(after,span.startNoteId)[0]?.id===span.startNoteId &&
      getTrillChain(after,span.startNoteId).at(-1)?.id===span.endNoteId ? [span] : [];
    const previous=getTrillChain(before,old.startNoteId);
    const remap=normalized && previous.some(note=>note.id===normalized.oldNoteId);
    const next=getTrillChain(after,remap ? normalized.newNoteId : span.startNoteId);
    if(!next.length || !canApplyTrill(after,next[0].id)) return [];
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
/** Even attacks, derived across the whole range. No metrical notes are inserted. */
export function getTrillAttacks(main:number, auxiliary:number, settings:TrillSettings, duration:number) {
  if(!isValidTrill(settings) || !Number.isFinite(duration) || duration<=0) return [];
  return Array.from({length:settings.attackCount},(_,index)=>({
    midi:(index%2===0)===(settings.start==='main') ? main : auxiliary,
    offset:index*duration/settings.attackCount,
    duration:duration/settings.attackCount,
  }));
}
