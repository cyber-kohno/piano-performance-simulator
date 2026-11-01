import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject,createMeasureData } from '../src/model/project.ts';
import { canApplyArpeggio,getArpeggioAttacks } from '../src/model/arpeggio.ts';
import { createExpressionEditor,controlExpressionEditor,getExpressionRows,validateExpressionDraft,arpeggioFromDraft,staccatoFromDraft } from '../src/state/expression-editor.ts';
import { createTimelineCursor,addTimelineNoteAt,addFocusedNotePitch,setFocusedNoteArpeggio,setFocusedNoteStaccato,setFocusedNoteExpressions,getLocatedTimelineNote,getLocatedTimelineNotes,
  appendFocusedTimelineTie,setFocusedTimelineNoteType,normalizeFocusedTimelineTie,duplicateFocusedTimelineNoteAfter,deleteFocusedTimelineNote,toggleTieToAdjacentTimelineNote,moveFocusedTimelineNote } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
const defaults={type:'normal',spreadRatio:0.5,timing:1};
const mark=s=>getLocatedTimelineNote(s.project.outline,s.cursor.focusedNoteId).note;
const key=(e,n,k)=>controlExpressionEditor(e,n,k);
function placed(type='quarter',chord=true) { const p=createProject();for(let i=0;i<2;i++)p.outline.push({id:`m${i}`,type:'measure',data:createMeasureData({cnt:4,unit:4})});let s=addTimelineNoteAt(p,{...createTimelineCursor(),placementValue:{type,dots:0}});if(chord)s=addFocusedNotePitch(s.project,s.cursor);return s; }
test('arpeggio uses the existing modal framework, defaults and exact tenth-step limits without mutating the note',()=>{
 const s=placed(),n=mark(s),before=structuredClone(n);let e=createExpressionEditor(n);e=key(e,n,'ArrowDown');e=key(e,n,'Enter');
 assert.equal(e.detail,'arpeggio');assert.deepEqual(arpeggioFromDraft(e),defaults);
 e=key(e,n,'ArrowRight');assert.equal(arpeggioFromDraft(e).type,'down');
 e=key(e,n,'ArrowDown');for(let i=0;i<20;i++)e=key(e,n,'ArrowRight');assert.equal(e.draft.arpeggio.spreadRatio,1);
 for(let i=0;i<20;i++)e=key(e,n,'ArrowLeft');assert.equal(e.draft.arpeggio.spreadRatio,0.1);
 e=key(e,n,'ArrowDown');for(let i=0;i<20;i++)e=key(e,n,'ArrowLeft');assert.equal(e.draft.arpeggio.timing,0);
 for(let i=0;i<20;i++)e=key(e,n,'ArrowRight');assert.equal(e.draft.arpeggio.timing,1);
 assert.deepEqual(n,before);assert.equal(validateExpressionDraft(e,n),undefined);
});
test('the draft disallows both effects and enables switching only after an explicit parent deletion',()=>{
 const n=mark(placed());let e=key(createExpressionEditor(n),n,'Enter');e=key(e,n,'Backspace');e=key(e,n,'ArrowDown');
 assert.equal(getExpressionRows(e,n)[1].disabled,true);assert.equal(key(e,n,'Enter'),e);
 e=key(e,n,'ArrowUp');e=key(e,n,'Delete');e=key(e,n,'ArrowDown');e=key(e,n,'Enter');e=key(e,n,'Backspace');
 assert.equal(getExpressionRows(e,n)[0].disabled,true);assert.equal(getExpressionRows(e,n)[1].disabled,false);
 e=key(e,n,'Delete');assert.equal(Object.hasOwn(e.draft,'arpeggio'),false);assert.equal(getExpressionRows(e,n)[0].disabled,false);
});
test('single pitches, 32nds and incoming ties disable arpeggio, while an outgoing tie is permitted',()=>{
 const chord=mark(placed());
 for(const n of [mark(placed('quarter',false)),mark(placed('32nd')),{...chord,tieFrom:'previous'}]){
   assert.equal(canApplyArpeggio(n),false);let e=createExpressionEditor(n);e=key(e,n,'ArrowDown');assert.equal(getExpressionRows(e,n)[1].disabled,true);assert.equal(key(e,n,'Enter'),e);
 }
 assert.equal(canApplyArpeggio({...chord,tieTo:'next'}),true);
});
test('atomic expression commits can switch either way without silently removing the other effect in single-effect setters',()=>{
 const s=placed();let p=setFocusedNoteStaccato(s.project,s.cursor,{type:'normal',lengthRatio:0.5});
 assert.equal(setFocusedNoteArpeggio(p,s.cursor,defaults),p);
 let e=createExpressionEditor(getLocatedTimelineNote(p.outline,s.cursor.focusedNoteId).note);const n=mark(s);
 e=key(e,n,'Delete');e=key(e,n,'ArrowDown');e=key(e,n,'Enter');
 const updated=setFocusedNoteExpressions(p,s.cursor,{staccato:staccatoFromDraft(e),arpeggio:arpeggioFromDraft(e)});
 const note=getLocatedTimelineNote(updated.outline,s.cursor.focusedNoteId).note;assert.equal(Object.hasOwn(note,'staccato'),false);assert.deepEqual(note.arpeggio,defaults);
 assert.equal(setFocusedNoteStaccato(updated,s.cursor,{type:'normal',lengthRatio:0.5}),updated);
 const swapped=setFocusedNoteExpressions(updated,s.cursor,{staccato:{type:'normal',lengthRatio:0.7}});
 assert.equal(Object.hasOwn(getLocatedTimelineNote(swapped.outline,s.cursor.focusedNoteId).note,'arpeggio'),false);
});
test('invalid arpeggio values or incompatible combined drafts cannot reach the score',()=>{
 const s=placed(),n=mark(s);
 for(const setting of [{...defaults,type:'bad'},{...defaults,spreadRatio:0},{...defaults,spreadRatio:1.1},{...defaults,spreadRatio:0.55},{...defaults,timing:-0.1},{...defaults,timing:1.1},{...defaults,timing:NaN}]){
 assert.ok(validateExpressionDraft({draft:{arpeggio:setting},detail:null,row:0},n));assert.equal(setFocusedNoteArpeggio(s.project,s.cursor,setting),s.project); }
 assert.ok(validateExpressionDraft({draft:{arpeggio:defaults,staccato:{type:'normal',lengthRatio:0.5}},detail:null,row:0},n));
});
test('spread divides one sixteenth into pitch-count slots, and alignment spans first-to-last attacks',()=>{
 const pitches=[{midi:67},{midi:60},{midi:64}],settings={...defaults,spreadRatio:1};const before=structuredClone(pitches);
 for(const [timing,expected] of [[0,[0,50,100]],[0.5,[-50,0,50]],[1,[-100,-50,0]]])assert.deepEqual(getArpeggioAttacks(pitches,{...settings,timing},150).map(a=>a.offset),expected);
 assert.deepEqual(getArpeggioAttacks(pitches,{...settings,type:'down',timing:1},150).map(a=>a.midi),[67,64,60]);
 assert.deepEqual(getArpeggioAttacks(pitches,{...defaults,timing:0},150).map(a=>a.offset),[0,25,50]);assert.deepEqual(pitches,before);
});
test('MusicXML emits matching chord-wide notation and direction without changing written durations or exporting app timing parameters',()=>{
 const s=placed(),before=createScorePreview(s.project.outline,0).xml;
 const p=setFocusedNoteArpeggio(s.project,s.cursor,{...defaults,type:'down'}),xml=createScorePreview(p.outline,0).xml;
 assert.equal((xml.match(/<arpeggiate number="1" direction="down"\/>/g)||[]).length,2);
 assert.deepEqual([...xml.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]),[...before.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]));
 assert.doesNotMatch(xml,/spreadRatio|timing=|attack=/);
 const normal=createScorePreview(setFocusedNoteArpeggio(s.project,s.cursor,defaults).outline,0).xml;assert.match(normal,/<arpeggiate number="1"\/>/);
});
test('movement and normalization retain arpeggio only at its attack, and explicit 32nd conversion is rejected',()=>{
 let s=placed();s.project=setFocusedNoteArpeggio(s.project,s.cursor,defaults);s=appendFocusedTimelineTie(s.project,s.cursor);
 assert.equal(mark(s).arpeggio,undefined);s=normalizeFocusedTimelineTie(s.project,s.cursor);
 assert.equal(getLocatedTimelineNotes(s.project.outline,'upperStaff',0).filter(e=>e.note.arpeggio).length,1);
 s=moveFocusedTimelineNote(s.project,s.cursor,1);
 const first=getLocatedTimelineNotes(s.project.outline,'upperStaff',0)[0];const cursor={...s.cursor,focusedNoteId:first.note.id,positionSixteenths:first.measureStartSixteenths+first.positionSixteenths};
 assert.deepEqual(first.note.arpeggio,defaults);assert.equal(setFocusedTimelineNoteType(s.project,cursor,'4'),undefined);
});
test('pitch removal cannot leave a single-note arpeggio, duplication retains settings and removal deletes the optional field',()=>{
 let s=placed();s.project=setFocusedNoteArpeggio(s.project,s.cursor,defaults);assert.equal(deleteFocusedTimelineNote(s.project,s.cursor,true),undefined);
 const copy=duplicateFocusedTimelineNoteAfter(s.project,s.cursor);assert.deepEqual(mark(copy).arpeggio,defaults);
 assert.equal(toggleTieToAdjacentTimelineNote(copy.project,s.cursor),undefined);
 assert.equal(duplicateFocusedTimelineNoteAfter(s.project,{...s.cursor,placementValue:{type:'32nd',dots:0}}),undefined);
 const removed=setFocusedNoteArpeggio(s.project,s.cursor,undefined);assert.equal(Object.hasOwn(getLocatedTimelineNote(removed.outline,s.cursor.focusedNoteId).note,'arpeggio'),false);
});
