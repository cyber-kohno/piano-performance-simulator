import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExpressionEditor, controlExpressionEditor, getExpressionRows, validateExpressionDraft, staccatoFromDraft, changeExpressionField } from '../src/state/expression-editor.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor, addTimelineNoteAt, appendFocusedTimelineTie, setFocusedNoteStaccato, getLocatedTimelineNote, normalizeFocusedTimelineTie } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
const note = (extra={})=>({id:'n',kind:'note',value:{type:'quarter',dots:0},pitches:[{midi:60}],...extra});
const key=(state,n,k)=>controlExpressionEditor(state,n,k);
function placed() {const project=createProject();project.outline.push({id:'m',type:'measure',data:createMeasureData({cnt:4,unit:4})});return addTimelineNoteAt(project,createTimelineCursor());}
test('opening and editing an isolated draft leaves the score untouched until explicit apply',()=>{
  const n=note({staccato:{type:'normal',lengthRatio:0.7}}), original=structuredClone(n);
  let editor=createExpressionEditor(n);
  editor=key(editor,n,'Enter');assert.equal(editor.draft.staccato.lengthRatio,0.7);
  editor=key(editor,n,'ArrowRight');assert.deepEqual(editor.draft.staccato,{type:'staccatissimo',lengthRatio:0.3});
  assert.deepEqual(n,original);
  assert.deepEqual(createExpressionEditor(n).draft.staccato,original.staccato);
});
test('parent Enter creates defaults, Backspace returns, Delete removes only the optional expression',()=>{
  const n=note();let e=createExpressionEditor(n);
  for(const k of ['ArrowLeft','ArrowRight','Backspace','Delete']) e=key(e,n,k);
  assert.deepEqual(e.draft,{});
  e=key(e,n,'Enter');assert.equal(e.detail,'staccato');assert.deepEqual(e.draft.staccato,{type:'normal',lengthRatio:0.5});
  e=key(e,n,'Delete');assert.ok(e.draft.staccato);
  e=key(e,n,'Backspace');assert.equal(e.detail,null);
  e=key(e,n,'Delete');assert.equal(Object.hasOwn(e.draft,'staccato'),false);
  assert.equal(staccatoFromDraft(e),undefined);
});
test('type changes reset the matching default while a clamped type does not reset a customized ratio',()=>{
  const n=note();let e=key(createExpressionEditor(n),n,'Enter');
  e=key(e,n,'ArrowRight');assert.deepEqual(e.draft.staccato,{type:'staccatissimo',lengthRatio:0.3});
  e=key(e,n,'ArrowDown');e=key(e,n,'ArrowRight');assert.equal(e.draft.staccato.lengthRatio,0.4);
  e=key(e,n,'ArrowUp');e=key(e,n,'ArrowRight');assert.equal(e.draft.staccato.lengthRatio,0.4);
  e=key(e,n,'ArrowLeft');assert.deepEqual(e.draft.staccato,{type:'normal',lengthRatio:0.5});
});
test('ratio adjusts in exact tenths and clamps at 0.1 and 0.9, with bounded row navigation',()=>{
  const n=note();let e=key(createExpressionEditor(n),n,'Enter');e=key(e,n,'ArrowDown');
  for(let i=0;i<20;i++)e=key(e,n,'ArrowLeft');assert.equal(e.draft.staccato.lengthRatio,0.1);
  for(let i=0;i<8;i++){e=key(e,n,'ArrowRight');assert.equal(e.draft.staccato.lengthRatio,Number((0.2+i*0.1).toFixed(1)));}
  e=key(e,n,'ArrowRight');assert.equal(e.draft.staccato.lengthRatio,0.9);
  assert.equal(key(e,n,'ArrowDown').row,1);
  assert.equal(key(key(e,n,'ArrowUp'),n,'ArrowUp').row,0);
  assert.equal(getExpressionRows(e,n)[1].value,'0.9');
});
test('outgoing tie disables the parent and protects both absent and already present settings',()=>{
  for(const n of [note({tieTo:'next'}),note({tieTo:'next',staccato:{type:'normal',lengthRatio:0.5}})]){
    const e=createExpressionEditor(n);assert.equal(getExpressionRows(e,n)[0].disabled,true);
    for(const k of ['Enter','Delete','ArrowLeft','ArrowRight'])assert.deepEqual(key(e,n,k),e);
    assert.equal(validateExpressionDraft(e,n),undefined);
    assert.ok(validateExpressionDraft({...e,draft:{staccato:{type:'staccatissimo',lengthRatio:0.3}}},n));
  }
  const terminal=note({tieFrom:'previous'});assert.equal(getExpressionRows(createExpressionEditor(terminal),terminal)[0].disabled,false);
});
test('invalid enum, out-of-range or non-tenth ratios never pass validation or reach the score',()=>{
  const state=placed();
  for(const setting of [{type:'bad',lengthRatio:0.5},{type:'normal',lengthRatio:0},{type:'normal',lengthRatio:1},{type:'normal',lengthRatio:0.55},{type:'normal',lengthRatio:NaN}]){
    assert.ok(validateExpressionDraft({draft:{staccato:setting},detail:null,row:0},note()));
    assert.equal(setFocusedNoteStaccato(state.project,state.cursor,setting),state.project);
  }
});
test('applying or deleting settings retains notation time, pitches and other note metadata',()=>{
  const s=placed(), before=structuredClone(s.project);
  const updated=setFocusedNoteStaccato(s.project,s.cursor,{type:'staccatissimo',lengthRatio:0.2});
  assert.deepEqual(s.project,before);
  const current=getLocatedTimelineNote(updated.outline,s.cursor.focusedNoteId).note;
  assert.deepEqual(current.staccato,{type:'staccatissimo',lengthRatio:0.2});
  assert.deepEqual(current.value,getLocatedTimelineNote(before.outline,s.cursor.focusedNoteId).note.value);
  assert.deepEqual(current.pitches,getLocatedTimelineNote(before.outline,s.cursor.focusedNoteId).note.pitches);
  const removed=setFocusedNoteStaccato(updated,s.cursor,undefined);
  assert.equal(Object.hasOwn(getLocatedTimelineNote(removed.outline,s.cursor.focusedNoteId).note,'staccato'),false);
});
test('the model rejects new staccato on outgoing ties and permits the tail without changing tie creation',()=>{
  let s=placed();const first=s.cursor;s=appendFocusedTimelineTie(s.project,s.cursor);
  assert.equal(setFocusedNoteStaccato(s.project,first,{type:'normal',lengthRatio:0.5}),s.project);
  const updated=setFocusedNoteStaccato(s.project,s.cursor,{type:'staccatissimo',lengthRatio:0.3});
  assert.deepEqual(getLocatedTimelineNote(updated.outline,s.cursor.focusedNoteId).note.staccato,{type:'staccatissimo',lengthRatio:0.3});
  const norm=normalizeFocusedTimelineTie(updated,s.cursor);
  assert.deepEqual(getLocatedTimelineNote(norm.project.outline,s.cursor.focusedNoteId).note.staccato,{type:'staccatissimo',lengthRatio:0.3});
});
test('MusicXML exports a single matching symbol for a chord and does not encode the app playback ratio as notation duration',()=>{
  const s=placed();s.project.outline[2].data.upperStaff.voices[0].elements[0].pitches.push({midi:64});
  const updated=setFocusedNoteStaccato(s.project,s.cursor,{type:'staccatissimo',lengthRatio:0.3});
  const xml=createScorePreview(updated.outline,0).xml;
  assert.equal((xml.match(/<staccatissimo\/>/g)||[]).length,1);assert.doesNotMatch(xml,/<staccato\/>/);
  assert.deepEqual([...xml.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]),[...createScorePreview(s.project.outline,0).xml.matchAll(/<duration>(.*?)<\/duration>/g)].map(m=>m[1]));
});
test('the common value editor also supports boolean fields',()=>{
  assert.equal(changeExpressionField({id:'flag',label:'Flag',kind:'flag'},false,1),true);
  assert.equal(changeExpressionField({id:'flag',label:'Flag',kind:'flag'},true,-1),false);
});
