import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, getFlattenedVoiceElements, getElementTime } from '../src/model/project.ts';
import { createTimelineCursor, addTimelineNoteAt, getLocatedTimelineNote, getLocatedTimelineNotes,
  moveFocusedTimelineNote, deleteFocusedTimelineNote, setFocusedTimelineNoteType, addFocusedNotePitch,
  appendFocusedTimelineTie, duplicateFocusedTimelineNoteAfter, normalizeFocusedTimelineTie,
  resizeFocusedTimelineTie, convertFocusedTimelineTuplet, extendTimelineNoteSelection } from '../src/state/timeline-cursor.ts';
import { addBeforeGrace, cycleGraceFocus, focusGraceParent, getFocusedGrace, moveGracePitch,
  deleteFocusedGrace, getGraceRollLayout } from '../src/state/grace-input.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import NotePitches from '../src/domain/score/note-pitches.ts';
import Validator from '../src/domain/score/score-project-validator.ts';
import EditorHistory from '../src/service/history/editor-history.ts';
function score() {
  const p=createProject();
  for(let i=0;i<3;i++) p.outline.push({id:`m${i}`,type:'measure',data:createMeasureData({cnt:4,unit:4})});
  return p;
}
function placed(type='quarter',position=0,midi=60) {
  return addTimelineNoteAt(score(),{...createTimelineCursor(),placementValue:{type,dots:0}},position,midi);
}
const parent=s=>getLocatedTimelineNote(s.project.outline,s.cursor.focusedNoteId,s.cursor.staff).note;
const graced=s=>addBeforeGrace(s.project,s.cursor);
const parentFocus=s=>({...s,cursor:focusGraceParent(s.project.outline,s.cursor)});

test('fingering follows grace focus, preserves other notes, and survives history and serialization',()=>{
  let s=graced(placed());
  s=graced(s);
  s=parentFocus(s);
  s.project=NoteEditor.setPitchFingering(s.project,s.cursor,5);
  s.cursor=cycleGraceFocus(s.project.outline,s.cursor);
  const before=structuredClone(s.project);
  const history=EditorHistory.create({project:s.project,timelineCursor:s.cursor});
  assert.equal(NoteEditor.setPitchFingering(s.project,s.cursor,1,2),s.project);
  const updated=NoteEditor.setPitchFingering(s.project,s.cursor,1);
  const updatedParent=parent({...s,project:updated});
  assert.deepEqual(updatedParent.pitches,[{midi:60,fingering:5}]);
  assert.deepEqual(updatedParent.beforeGraceNotes[0].pitches,[{midi:59,fingering:1}]);
  assert.deepEqual(updatedParent.beforeGraceNotes[1],parent(s).beforeGraceNotes[1]);
  assert.deepEqual(s.project,before);
  history.record({project:updated,timelineCursor:s.cursor});
  assert.deepEqual(history.undo().project,before);
  assert.equal(history.redo().project,updated);
  const restored=JSON.parse(JSON.stringify(updated));
  assert.equal(Validator.isValid(restored),true);
  assert.deepEqual(restored,updated);
  const xml=createScorePreview(restored.outline,0).xml;
  assert.match(xml.match(/<note><grace[\s\S]*?<\/note>/)[0],/<fingering>1<\/fingering>/);
  const single=NoteEditor.setPitchFingering(updated,s.cursor,3);
  assert.deepEqual(parent({...s,project:single}).beforeGraceNotes[0].pitches,[{midi:59,fingering:3}]);
  const secondCursor=cycleGraceFocus(single.outline,s.cursor);
  const second=NoteEditor.setPitchFingering(single,secondCursor,4);
  assert.equal(parent({...s,project:second}).beforeGraceNotes[1].pitches[0].fingering,4);
  assert.equal(parent({...s,project:second}).beforeGraceNotes[0].pitches[0].fingering,3);
  const parentCursor=cycleGraceFocus(second.outline,secondCursor);
  const changedParent=NoteEditor.setPitchFingering(second,parentCursor,2);
  assert.equal(parent({...s,project:changedParent}).pitches[0].fingering,2);
  assert.deepEqual(parent({...s,project:changedParent}).beforeGraceNotes,parent({...s,project:second}).beforeGraceNotes);
});

test('missing grace targets never fall back to parent fingering, and removal clears both numbers',()=>{
  const s=graced(placed());
  const missing={...s.cursor,focusedGraceId:'missing'};
  assert.equal(NoteEditor.setPitchFingering(s.project,missing,2),s.project);
  assert.equal(NoteEditor.setPitchFingering(s.project,{...s.cursor,focusedPitchIndex:9},2),s.project);
  const updated=NoteEditor.setPitchFingering(s.project,s.cursor,1);
  const cleared=NotePitches.setFingering(updated,{
    noteId:s.cursor.focusedNoteId,staff:s.cursor.staff,pitchIndex:0,graceNoteId:s.cursor.focusedGraceId,
  },null);
  assert.deepEqual(parent({...s,project:cleared}).beforeGraceNotes,parent(s).beforeGraceNotes);
});

test('lower-staff grace fingering respects staff targeting',()=>{
  const placedLower=addTimelineNoteAt(score(),{...createTimelineCursor(),staff:'lowerStaff'},0,48);
  const s=graced(placedLower);
  assert.equal(NoteEditor.setPitchFingering(s.project,s.cursor,4,3),s.project);
  const updated=NoteEditor.setPitchFingering(s.project,s.cursor,4);
  assert.equal(Validator.isValid(updated),true);
  assert.deepEqual(parent({...s,project:updated}).beforeGraceNotes[0].pitches,[{midi:47,fingering:4}]);
  assert.deepEqual(parent({...s,project:updated}).pitches,[{midi:48}]);
  assert.equal(NoteEditor.setPitchFingering(updated,s.cursor,4),updated);
  assert.equal(NoteEditor.setPitchFingering(updated,{...s.cursor,staff:'upperStaff'},2),updated);
});
function lengths(p) {
  return p.outline.filter(b=>b.type==='measure').map(b=>['upperStaff','lowerStaff'].flatMap(staff=>b.data[staff].voices.map(v=>
    getFlattenedVoiceElements(v,b.data.length).reduce((sum,e)=>sum+e.lengthSixteenths,0))));
}
test('Shift+W adds a slashed eighth grace a semitone below without changing musical time, rests or input value',()=>{
  const s=placed('16th'); const before=structuredClone(s.project);
  const next=addBeforeGrace(s.project,s.cursor);
  const grace=parent(next).beforeGraceNotes[0];
  assert.deepEqual(grace.pitches,[{midi:59}]);
  assert.deepEqual(grace.value,{type:'eighth',dots:0}); assert.equal(grace.slash,true);
  assert.equal(getFocusedGrace(next.project.outline,next.cursor).grace.id,grace.id);
  assert.equal(next.cursor.positionSixteenths,s.cursor.positionSixteenths);
  assert.deepEqual(next.cursor.placementValue,s.cursor.placementValue);
  assert.deepEqual(lengths(next.project),lengths(before));
  assert.deepEqual(next.project.outline[2].data.upperStaff.voices[0].elements.slice(1),before.outline[2].data.upperStaff.voices[0].elements.slice(1));
  assert.deepEqual(s.project,before);
});
test('W cycles parent and ordered graces; insertion after a grace stays flat and parent focus appends',()=>{
  let s=placed();s=addBeforeGrace(s.project,s.cursor);const a=parent(s).beforeGraceNotes[0].id;
  s=addBeforeGrace(s.project,s.cursor);const b=getFocusedGrace(s.project.outline,s.cursor).grace.id;
  assert.deepEqual(parent(s).beforeGraceNotes.map(g=>g.pitches[0].midi),[59,58]);
  s.cursor=cycleGraceFocus(s.project.outline,s.cursor);assert.equal(s.cursor.focusedGraceId,null);assert.equal(s.cursor.pitch,60);
  s.cursor=cycleGraceFocus(s.project.outline,s.cursor);assert.equal(s.cursor.focusedGraceId,a);
  s=addBeforeGrace(s.project,s.cursor);const c=s.cursor.focusedGraceId;
  assert.deepEqual(parent(s).beforeGraceNotes.map(g=>g.id),[a,c,b]);
  assert.ok(parent(s).beforeGraceNotes.every(g=>!('beforeGraceNotes' in g)));
  s=parentFocus(s);s=addBeforeGrace(s.project,s.cursor);
  assert.equal(parent(s).beforeGraceNotes.at(-1).id,s.cursor.focusedGraceId);
});
test('ineligible parent, no focus, range and lower piano bound reject grace creation',()=>{
  const small=placed('32nd');assert.equal(addBeforeGrace(small.project,small.cursor),undefined);
  const low=placed('quarter',0,21);assert.equal(addBeforeGrace(low.project,low.cursor),undefined);
  const p=score();assert.equal(addBeforeGrace(p,createTimelineCursor()),undefined);
  let chord=placed();chord=addFocusedNotePitch(chord.project,chord.cursor);
  assert.equal(addBeforeGrace(chord.project,chord.cursor),undefined);
  let s=placed();s=addTimelineNoteAt(s.project,s.cursor,8,64);
  s.cursor=extendTimelineNoteSelection(s.project.outline,s.cursor,-1);
  assert.equal(addBeforeGrace(s.project,s.cursor),undefined);
});
test('grace pitch edits and deletion leave parent pitch, ties, rests and other graces untouched',()=>{
  let s=placed();s=addBeforeGrace(s.project,s.cursor);s=addBeforeGrace(s.project,s.cursor);
  const before=structuredClone(parent(s));
  s=moveGracePitch(s.project,s.cursor,1); assert.equal(s.cursor.pitch,59);
  assert.deepEqual(parent(s).pitches,before.pitches);
  assert.deepEqual(parent(s).beforeGraceNotes[0],before.beforeGraceNotes[0]);
  s=deleteFocusedGrace(s.project,s.cursor);assert.equal(parent(s).beforeGraceNotes.length,1);assert.equal(s.cursor.focusedGraceId,null);
  s.cursor=cycleGraceFocus(s.project.outline,s.cursor);s=deleteFocusedGrace(s.project,s.cursor);
  assert.equal(parent(s).beforeGraceNotes,undefined);assert.equal(s.cursor.pitch,60);
});
test('grace edits respect piano bounds and support normal diatonic or octave pitch movement',()=>{
  let s=graced(placed('quarter',0,108));
  s=moveGracePitch(s.project,s.cursor,1);assert.equal(s.cursor.pitch,108);
  assert.equal(moveGracePitch(s.project,s.cursor,1),undefined);
  s=moveGracePitch(s.project,s.cursor,-1,false,true);assert.equal(s.cursor.pitch,96);
  let low=placed('quarter',0,22);low=addBeforeGrace(low.project,low.cursor);
  assert.equal(moveGracePitch(low.project,low.cursor,-1),undefined);
  let d=placed();d=addBeforeGrace(d.project,d.cursor);d=moveGracePitch(d.project,d.cursor,-1,true);assert.equal(d.cursor.pitch,57);
});
test('parent time movement and deletion carry or remove the whole grace list',()=>{
  let s=parentFocus(graced(placed()));
  const graceId=parent(s).beforeGraceNotes[0].id;
  const moved=moveFocusedTimelineNote(s.project,s.cursor,1);
  assert.equal(parent(moved).beforeGraceNotes[0].id,graceId);assert.equal(moved.cursor.positionSixteenths,4);
  const deleted=deleteFocusedTimelineNote(moved.project,moved.cursor);
  assert.equal(getLocatedTimelineNotes(deleted.project.outline,'upperStaff',0).length,0);
  assert.deepEqual(lengths(deleted.project),[[16,16],[16,16],[16,16]]);
});
test('grace parents reject 32nd notation and chord additions anywhere in their tie chain',()=>{
  let s=parentFocus(graced(placed()));
  assert.equal(setFocusedTimelineNoteType(s.project,s.cursor,'4'),undefined);
  assert.equal(addFocusedNotePitch(s.project,s.cursor),undefined);
  s=appendFocusedTimelineTie(s.project,s.cursor);
  assert.equal(addFocusedNotePitch(s.project,s.cursor),undefined);
});
test('normalization preserves grace attachment boundaries and rejects removing or shortening a grace parent to 32nd',()=>{
  let s=placed('quarter');s=appendFocusedTimelineTie(s.project,s.cursor);
  s=parentFocus(addBeforeGrace(s.project,s.cursor));
  const graceId=parent(s).beforeGraceNotes[0].id;
  s=normalizeFocusedTimelineTie(s.project,s.cursor);
  assert.equal(getLocatedTimelineNotes(s.project.outline,'upperStaff',0).length,2);
  assert.equal(parent(s).beforeGraceNotes[0].id,graceId);
  s.cursor={...s.cursor,placementValue:{type:'quarter',dots:0}};
  assert.equal(resizeFocusedTimelineTie(s.project,s.cursor,-1),undefined);
  let short=parentFocus(graced(placed('16th')));
  short.cursor={...short.cursor,placementValue:{type:'32nd',dots:0}};
  assert.equal(resizeFocusedTimelineTie(short.project,short.cursor,-1),undefined);
});
test('duplication creates independent grace ids; tie append adds no repeated grace attack',()=>{
  let s=parentFocus(graced(placed()));
  const original=parent(s).beforeGraceNotes[0];
  const copy=duplicateFocusedTimelineNoteAfter(s.project,s.cursor);
  assert.notEqual(parent(copy).beforeGraceNotes[0].id,original.id);
  assert.deepEqual(parent(copy).beforeGraceNotes[0].pitches,original.pitches);
  assert.equal(parent(appendFocusedTimelineTie(s.project,s.cursor)).beforeGraceNotes,undefined);
  assert.equal(duplicateFocusedTimelineNoteAfter(s.project,{...s.cursor,placementValue:{type:'32nd',dots:0}}),undefined);
});
test('grace editing in tuplets keeps performed group duration and retained notation',()=>{
  let s=placed();s=convertFocusedTimelineTuplet(s.project,s.cursor);s=addBeforeGrace(s.project,s.cursor);
  const total=lengths(s.project);s=moveGracePitch(s.project,s.cursor,1);
  assert.deepEqual(lengths(s.project),total);
  assert.equal(getElementTime(s.project.outline[2].data.upperStaff.voices[0].elements[0],{cnt:4,unit:4}).numerator,4);
});
test('MusicXML emits ordered slashed grace notes before their parent without durations or inherited tuplet timing',()=>{
  let s=placed('16th');s=addBeforeGrace(s.project,s.cursor);s=addBeforeGrace(s.project,s.cursor);
  const original=structuredClone(s.project);
  const xml=createScorePreview(s.project.outline,0).xml;
  const graces=[...xml.matchAll(/<note><grace[\s\S]*?<\/note>/g)].map(m=>m[0]);
  assert.equal(graces.length,2);
  assert.ok(graces.every(note=>note.includes('<grace slash="yes"/>')&&note.includes('<type>eighth</type>')&&!note.includes('<duration>')));
  assert.ok(graces[0].includes('<step>B</step>'));assert.ok(graces[1].includes('<step>A</step><alter>1</alter>'));
  assert.deepEqual(s.project,original);
});
test('grace roll circles shrink within one fixed sixteenth and have a minimum readable size',()=>{
  assert.ok(getGraceRollLayout(2,30)[0].diameter < getGraceRollLayout(1,30)[0].diameter);
  for(const count of [1,2,4,8,24]) for(const item of getGraceRollLayout(count,30)) {
    assert.ok(item.diameter>=4);assert.ok(item.x>0&&item.x<30);
  }
  assert.deepEqual(getGraceRollLayout(2,30),[{x:10,diameter:8},{x:20,diameter:8}]);
});
test('graces on tuplet or lower-staff parents export in their parent voice without consuming metrical ticks',()=>{
  let s=placed();s=convertFocusedTimelineTuplet(s.project,s.cursor);
  const durations=xml=>[...xml.matchAll(/<duration>(\d+)<\/duration>/g)].map(m=>Number(m[1]));
  const before=durations(createScorePreview(s.project.outline,0).xml);
  s=addBeforeGrace(s.project,s.cursor);
  const xml=createScorePreview(s.project.outline,0).xml;
  const grace=xml.match(/<note><grace[\s\S]*?<\/note>/)[0];
  assert.doesNotMatch(grace,/<duration>|<time-modification>|<tuplet/);
  assert.deepEqual(durations(xml),before);
  let lower=addTimelineNoteAt(score(),{...createTimelineCursor('lowerStaff'),placementValue:{type:'quarter',dots:0}},0,48);
  lower=addBeforeGrace(lower.project,lower.cursor);
  const lowerGrace=createScorePreview(lower.project.outline,0).xml.match(/<note><grace[\s\S]*?<\/note>/)[0];
  assert.match(lowerGrace,/<voice>4<\/voice>/);assert.match(lowerGrace,/<staff>2<\/staff>/);
});
