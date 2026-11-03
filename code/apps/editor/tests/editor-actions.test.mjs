import assert from 'node:assert/strict';
import { test } from 'node:test';
import NoteEditor from '../src/action/editor/note-editor.ts';
import OutlineEditor from '../src/action/editor/outline-editor.ts';
import PedalEditor from '../src/action/editor/pedal-editor.ts';
import { createProject, createMeasureData, getFlattenedVoiceElements } from '../src/model/project.ts';
import { createTimelineCursor, getLocatedTimelineNote, getTimelineTieChain } from '../src/state/timeline-cursor.ts';
import { DEFAULT_TRILL, getNoteTrill } from '../src/model/trill.ts';

function blank() {
 const project=createProject();
 for(let i=0;i<4;i++) project.outline.push({id:`m${i}`,type:'measure',data:createMeasureData({cnt:4,unit:4})});
 return project;
}
function tied(count=3) {
 let s=NoteEditor.add(blank(),{...createTimelineCursor(),placementValue:{type:'quarter',dots:0}});
 for(let i=1;i<count;i++)s=NoteEditor.appendTie(s.project,s.cursor);
 return {...s,project:NoteEditor.configure(s.project,s.cursor,{trill:DEFAULT_TRILL})};
}
function validVoices(project) {
 for(const measure of project.outline.filter(b=>b.type==='measure'))for(const staff of [measure.data.upperStaff,measure.data.lowerStaff])for(const voice of staff.voices) {
 const entries=getFlattenedVoiceElements(voice,measure.data.length);
 assert.equal(entries.reduce((sum,e)=>sum+e.lengthSixteenths,0),measure.data.length.cnt/measure.data.length.unit*16);
 }
}
test('action alone normalizes and grows a trill range, without a keyboard event or caller-side reconciliation',()=>{
 let s=tied(2);const id=s.project.trills[0].id;
 s=NoteEditor.normalizeTie(s.project,s.cursor);assert.equal(s.project.trills[0].id,id);
 assert.equal(getTimelineTieChain(s.project.outline,s.cursor.focusedNoteId).length,1);
 for(let i=0;i<4;i++)s=NoteEditor.resizeTie(s.project,s.cursor,1);
 assert.equal(s.project.trills[0].id,id);
 assert.equal(getNoteTrill(s.project,s.cursor.focusedNoteId).endNoteId,s.project.trills[0].endNoteId);
 s=NoteEditor.resizeTie(s.project,s.cursor,-1);assert.equal(s.project.trills[0].id,id);validVoices(s.project);
});
test('move preserves trill but delete, new tie member, unlink and ordinary value edits reconcile it immediately',()=>{
 const s=tied();const moved=NoteEditor.move(s.project,s.cursor,1);
 assert.deepEqual(moved.project.trills,s.project.trills);
 assert.equal(NoteEditor.remove(s.project,s.cursor).project.trills,undefined);
 assert.equal(NoteEditor.appendTie(s.project,s.cursor).project.trills,undefined);
 const head=getTimelineTieChain(s.project.outline,s.cursor.focusedNoteId)[0].note.id;
 assert.equal(NoteEditor.toggleTie(s.project,{...s.cursor,focusedNoteId:head}).trills,undefined);
 assert.equal(NoteEditor.setValue(s.project,s.cursor,{type:'eighth',dots:0}).project.trills,undefined);
});
test('modal settings commit together and read back from any member; rejected drafts are atomic',()=>{
 const s=tied(),chain=getTimelineTieChain(s.project.outline,s.cursor.focusedNoteId),head=chain[0].note.id;
 const cursor={...s.cursor,focusedNoteId:head};
 const changed=NoteEditor.configure(s.project,cursor,{trill:{...DEFAULT_TRILL,attackCount:13},tempo:{bpm:80},clef:{value:'bass'}});
 assert.equal(getNoteTrill(changed,chain[1].note.id).settings.attackCount,13);
 assert.deepEqual(changed.tempoChanges,[{noteId:head,bpm:80}]);
 assert.deepEqual(changed.clefChanges,[{noteId:head,clef:'bass'}]);
 assert.equal(NoteEditor.configure(changed,cursor,{trill:{...DEFAULT_TRILL,attackCount:1},tempo:{bpm:100}}),changed);
 assert.equal(NoteEditor.configure(changed,cursor,{trill:DEFAULT_TRILL,tempo:{bpm:999}}),changed);
});
test('deleting an anchored note removes tempo, clef, trill and slur references in the same action',()=>{
 let a=NoteEditor.add(blank(),createTimelineCursor(),0);
 let b=NoteEditor.add(a.project,{...a.cursor,focusedNoteId:null},4);
 let project=NoteEditor.configure(b.project,b.cursor,{trill:DEFAULT_TRILL,tempo:{bpm:80},clef:{value:'bass'}});
 project=NoteEditor.connectSlur(project,[a.cursor.focusedNoteId,b.cursor.focusedNoteId]);assert.equal(project.slurs.length,1);
 const result=NoteEditor.remove(project,b.cursor);
 assert.equal(result.project.trills,undefined);assert.deepEqual(result.project.tempoChanges,[]);assert.deepEqual(result.project.clefChanges,[]);
 assert.equal(result.project.slurs?.length ?? 0,0);validVoices(result.project);
});
test('outline deletion also removes all references, retaining the required initial section and initial values',()=>{
 const s=tied(1);const project=NoteEditor.configure(s.project,s.cursor,{trill:DEFAULT_TRILL,tempo:{bpm:90},clef:{value:'bass'}});
 const result=OutlineEditor.remove(project,{blockId:'m0'});
 assert.equal(result.project.trills,undefined);assert.deepEqual(result.project.tempoChanges,[]);assert.deepEqual(result.project.clefChanges,[]);
 assert.equal(OutlineEditor.remove(project,{blockId:project.outline[0].id}).project,project);
 assert.equal(OutlineEditor.remove(project,{blockId:project.outline[1].id}).project,project);
});
test('outline changes preserve cursor insertion rules, key change focus and blocked meter edits',()=>{
 let p=createProject();const section={blockId:p.outline[1].id};
 const m=OutlineEditor.addMeasure(p,section);assert.deepEqual(m.cursor,section);validVoices(m.project);
 const sec=OutlineEditor.addSection(m.project,section);assert.equal(sec.outline[2].type,'section');
 const key=OutlineEditor.addKeyChange(m.project,section);assert.equal(key.project.outline[2].id,key.cursor.blockId);
 assert.equal(OutlineEditor.changeMeter(m.project,{blockId:p.outline[0].id},'numerator',-1),m.project);
 const meter=OutlineEditor.changeMeter(p,{blockId:p.outline[0].id},'denominator',1);assert.deepEqual(meter.outline[0].data.timeSignature,{unit:8,cnt:12});
});
test('pedal editing goes through actions without disturbing an unrelated trill',()=>{
 const s=tied(1);let p=PedalEditor.add(s.project,0,'start');p=PedalEditor.add(p,8,'stop');
 assert.deepEqual(p.trills,s.project.trills);assert.equal(p.outline[2].data.pedalEvents.length,2);
 p=PedalEditor.remove(p,0);assert.equal(p.outline[2].data.pedalEvents.length,0);assert.deepEqual(p.trills,s.project.trills);
});
test('rejected and cursor-only operations do not alter source data or manufacture a project update',()=>{
 const s=tied(),snapshot=structuredClone(s.project);
 assert.equal(NoteEditor.move(s.project,s.cursor,-1),undefined);
 assert.deepEqual(s.project,snapshot);
 assert.equal(NoteEditor.configure(s.project,{...s.cursor,focusedNoteId:null},{trill:DEFAULT_TRILL}),s.project);
 assert.equal(OutlineEditor.changeTempo(s.project,{blockId:'m0'},1),s.project);
});
test('tuplets, pitches, graces and voices remain editable through the common action entry points',()=>{
 let s=NoteEditor.add(blank(),{...createTimelineCursor(),placementValue:{type:'quarter',dots:0}});
 const group=NoteEditor.convertTuplet(s.project,s.cursor);assert.ok(group);validVoices(group.project);
 const chord=NoteEditor.addPitch(s.project,s.cursor);assert.equal(getLocatedTimelineNote(chord.project.outline,chord.cursor.focusedNoteId).note.pitches.length,2);
 const grace=NoteEditor.addGrace(s.project,s.cursor);assert.ok(grace);assert.ok(NoteEditor.removeGrace(grace.project,grace.cursor));
 const voices=NoteEditor.addVoice(s.project,s.cursor);assert.equal(voices.outline[2].data.upperStaff.voices.length,2);validVoices(voices);
});
