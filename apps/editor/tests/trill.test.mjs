import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createProject,createMeasureData} from '../src/model/project.ts';
import {DEFAULT_TRILL,getTrillChain,getNoteTrill,setNoteTrill,reconcileTrills,getTrillAuxiliary,getTrillAttacks} from '../src/model/trill.ts';
import {createExpressionEditor,controlExpressionEditor,getExpressionRows,trillFromDraft,validateExpressionDraft} from '../src/state/expression-editor.ts';
import {createTimelineCursor,addTimelineNoteAt,appendFocusedTimelineTie,getLocatedTimelineNote,toggleTieToAdjacentTimelineNote,deleteFocusedTimelineNote,normalizeFocusedTimelineTie,resizeFocusedTimelineTie,moveFocusedTimelineNote,addFocusedNotePitch,moveFocusedTimelineNotePitch,setFocusedTimelineNoteType} from '../src/state/timeline-cursor.ts';
import {createScorePreview} from '../src/model/score-preview.ts';
function fixture(count=3) {
 const project=createProject();for(let i=0;i<4;i++)project.outline.push({id:`m${i}`,type:'measure',data:createMeasureData({cnt:4,unit:4})});
 let s=addTimelineNoteAt(project,{...createTimelineCursor(),placementValue:{type:'quarter',dots:0}});
 for(let i=1;i<count;i++)s=appendFocusedTimelineTie(s.project,s.cursor);
 const chain=getTrillChain(s.project,s.cursor.focusedNoteId);
 s.cursor={...s.cursor,focusedNoteId:chain[Math.floor(count/2)].id,positionSixteenths:Math.floor(count/2)*4};
 return s;
}
const apply=s=>({...s,project:setNoteTrill(s.project,s.cursor.focusedNoteId,DEFAULT_TRILL)});
function edit(s,op,normalize=false) {
 const result=op(s.project,s.cursor);assert.ok(result);
 const next=result.project ? result : {...s,project:result};
 return {...next,project:reconcileTrills(s.project,next.project,normalize ? {oldNoteId:s.cursor.focusedNoteId,newNoteId:next.cursor.focusedNoteId}:undefined)};
}
test('one project-owned range is edited from every member, with no note-local copies',()=>{
 const s=apply(fixture()),chain=getTrillChain(s.project,s.cursor.focusedNoteId);
 assert.equal(s.project.trills.length,1);const span=s.project.trills[0];
 assert.equal(span.startNoteId,chain[0].id);assert.equal(span.endNoteId,chain.at(-1).id);
 for(const note of chain){assert.deepEqual(getNoteTrill(s.project,note.id),span);assert.equal(Object.hasOwn(note,'trill'),false);}
 const updated=setNoteTrill(s.project,chain.at(-1).id,{...DEFAULT_TRILL,attackCount:13});
 assert.equal(updated.trills.length,1);assert.equal(updated.trills[0].id,span.id);
 assert.equal(getNoteTrill(updated,chain[0].id).settings.attackCount,13);
 const cleared=setNoteTrill(updated,chain[1].id,undefined);assert.equal(Object.hasOwn(cleared,'trills'),false);
});
test('modal on a middle tied note disables the note-only effects and enables the shared trill draft',()=>{
 const s=fixture(),note=getLocatedTimelineNote(s.project.outline,s.cursor.focusedNoteId).note;
 let e=createExpressionEditor(note);const rows=getExpressionRows(e,note);
 assert.deepEqual(rows.map(r=>r.disabled),[true,true,false]);
 e={...e,row:2};e=controlExpressionEditor(e,note,'Enter');assert.deepEqual(trillFromDraft(e),DEFAULT_TRILL);
 e=controlExpressionEditor(e,note,'ArrowRight');e=controlExpressionEditor(e,note,'ArrowDown');e=controlExpressionEditor(e,note,'ArrowRight');
 e=controlExpressionEditor(e,note,'ArrowDown');e=controlExpressionEditor(e,note,'ArrowRight');
 assert.deepEqual(trillFromDraft(e),{auxiliary:'half',start:'auxiliary',attackCount:9});
 for(let i=0;i<150;i++)e=controlExpressionEditor(e,note,'ArrowRight');assert.equal(trillFromDraft(e).attackCount,128);
 for(let i=0;i<150;i++)e=controlExpressionEditor(e,note,'ArrowLeft');assert.equal(trillFromDraft(e).attackCount,2);
 assert.equal(getExpressionRows(e,note)[2].value,'2');assert.equal(validateExpressionDraft(e,note),undefined);
 assert.equal(s.project.trills,undefined);
 e=controlExpressionEditor(e,note,'Backspace');e=controlExpressionEditor(e,note,'Delete');assert.equal(trillFromDraft(e),undefined);
});
test('invalid settings and chords cannot receive a trill; ordinary note lengths retain default 8',()=>{
 for(const count of [2,3]){
  const s=fixture(count);for(const setting of [{...DEFAULT_TRILL,attackCount:1},{...DEFAULT_TRILL,attackCount:129},{...DEFAULT_TRILL,attackCount:2.5},{...DEFAULT_TRILL,auxiliary:'bad'},{...DEFAULT_TRILL,start:'bad'}]){
   assert.equal(setNoteTrill(s.project,s.cursor.focusedNoteId,setting),s.project);
   const n=getLocatedTimelineNote(s.project.outline,s.cursor.focusedNoteId).note;
   assert.ok(validateExpressionDraft({draft:{trill:setting},detail:null,row:2},n));
  }
 }
 const s=fixture(1),chord=addFocusedNotePitch(s.project,s.cursor);assert.ok(chord);
 assert.equal(setNoteTrill(chord.project,chord.cursor.focusedNoteId,DEFAULT_TRILL),chord.project);
 for(const key of ['1','2','3','4']){
  const changed=setFocusedTimelineNoteType(s.project,s.cursor,key) ?? s;
  assert.equal(setNoteTrill(changed.project,changed.cursor.focusedNoteId,DEFAULT_TRILL).trills[0].settings.attackCount,8);
 }
});
test('partial deletion, tie removal and joining a new note remove the entire range',()=>{
 let s=apply(fixture());s=edit(s,deleteFocusedTimelineNote);assert.equal(s.project.trills,undefined);
 s=apply(fixture());s=edit(s,toggleTieToAdjacentTimelineNote);assert.equal(s.project.trills,undefined);
 s=apply(fixture());const chain=getTrillChain(s.project,s.cursor.focusedNoteId);s.cursor={...s.cursor,focusedNoteId:chain.at(-1).id};
 s=edit(s,appendFocusedTimelineTie);assert.equal(s.project.trills,undefined);
});
test('moving the full tie chain preserves the range and settings',()=>{
 let s=apply(fixture()),span=structuredClone(s.project.trills[0]);s=edit(s,(p,c)=>moveFocusedTimelineNote(p,c,1));
 assert.deepEqual(s.project.trills,[span]);assert.equal(getTrillChain(s.project,span.startNoteId).length,3);
});
test('normalization remaps references after merging; normalized growth and shrink preserve settings across bars',()=>{
 let s=apply(fixture(2)),id=s.project.trills[0].id;
 s=edit(s,normalizeFocusedTimelineTie,true);assert.equal(s.project.trills[0].id,id);
 assert.equal(getTrillChain(s.project,s.cursor.focusedNoteId).length,1);
 for(let i=0;i<4;i++)s=edit(s,(p,c)=>resizeFocusedTimelineTie(p,c,1),true);
 assert.equal(s.project.trills[0].id,id);assert.equal(getNoteTrill(s.project,s.cursor.focusedNoteId).endNoteId,s.project.trills[0].endNoteId);
 assert.ok(getTrillChain(s.project,s.cursor.focusedNoteId).length>=2);
 s=edit(s,(p,c)=>resizeFocusedTimelineTie(p,c,-1),true);assert.equal(s.project.trills[0].id,id);
 for(const span of s.project.trills){assert.ok(getLocatedTimelineNote(s.project.outline,span.startNoteId));assert.ok(getLocatedTimelineNote(s.project.outline,span.endNoteId));}
});
test('uncertain pitch, duration and chord edits safely discard the range, while unrelated edits retain it',()=>{
 const s=apply(fixture());
 assert.equal(edit(s,(p,c)=>moveFocusedTimelineNotePitch(p,c,1)).project.trills,undefined);
 assert.equal(edit(s,(p,c)=>setFocusedTimelineNoteType(p,c,'2')).project.trills,undefined);
 assert.equal(edit(s,addFocusedNotePitch).project.trills,undefined);
 assert.deepEqual(reconcileTrills(s.project,{...s.project,outline:[...s.project.outline]}).trills,s.project.trills);
});
test('auxiliary tones follow the next letter and key signature or explicit semitone/whole-tone choices',()=>{
 assert.equal(getTrillAuxiliary(64,{fifths:0},'diatonic').midi,65);
 assert.deepEqual(getTrillAuxiliary(69,{fifths:-1},'diatonic'),{midi:70,step:'B',octave:4,alter:-1});
 assert.equal(getTrillAuxiliary(71,{fifths:0},'diatonic').midi,72);
 assert.equal(getTrillAuxiliary(69,{fifths:-1},'whole').midi,71);
 assert.equal(getTrillAuxiliary(64,{fifths:0},'whole').alter,1);
 assert.equal(getTrillAuxiliary(60,{fifths:0},'half').alter,-1);
});
test('even playback attacks cover the combined duration with either starting pitch, without inserting notation notes',()=>{
 const attacks=getTrillAttacks(60,62,DEFAULT_TRILL,800);
 assert.equal(attacks.length,8);assert.deepEqual(attacks[0],{midi:60,offset:0,duration:100});assert.equal(attacks.at(-1).offset,700);
 assert.equal(getTrillAttacks(60,62,{...DEFAULT_TRILL,start:'auxiliary'},800)[0].midi,62);
});
test('MusicXML includes one trill start and a spanning wave, with clipped windows and explicit auxiliary accidental',()=>{
 let s=apply(fixture(3));s.project=setNoteTrill(s.project,s.cursor.focusedNoteId,{...DEFAULT_TRILL,auxiliary:'whole',start:'auxiliary',attackCount:9});
 const xml=createScorePreview(s.project.outline,0,s.project.trills).xml;
 assert.equal((xml.match(/<trill-mark/g)||[]).length,1);assert.match(xml,/start-note="upper" beats="9"/);
 assert.equal((xml.match(/wavy-line type="start"/g)||[]).length,1);assert.equal((xml.match(/wavy-line type="stop"/g)||[]).length,1);
 const bare=createScorePreview(s.project.outline,0).xml;
 assert.deepEqual([...xml.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]),[...bare.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]));
 s=fixture(1);s.cursor={...s.cursor,pitch:64}; // explicit accidental tested using stored main pitch
 const note=getLocatedTimelineNote(s.project.outline,s.cursor.focusedNoteId).note;note.pitches[0].midi=64;
 s=apply(s);s.project=setNoteTrill(s.project,s.cursor.focusedNoteId,{...DEFAULT_TRILL,auxiliary:'whole'});
 assert.match(createScorePreview(s.project.outline,0,s.project.trills).xml,/<accidental-mark placement="above">sharp<\/accidental-mark>/);
 s=apply(fixture(13));const clipped=createScorePreview(s.project.outline,2,s.project.trills).xml;
 assert.match(clipped,/<trill-mark/);assert.match(clipped,/wavy-line type="start"/);assert.match(clipped,/wavy-line type="stop"/);
});
