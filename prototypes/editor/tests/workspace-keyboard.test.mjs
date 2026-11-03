import assert from 'node:assert/strict';
import {test} from 'node:test';
import WorkspaceKeyboard from '../src/ui/keyboard/workspace-keyboard.ts';
import EditorNavigation from '../src/state/editor-navigation.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import {createOutlineCursor} from '../src/state/outline-cursor.ts';
import {createTimelineCursor} from '../src/state/timeline-cursor.ts';
const holds={rangeSelection:false,pitchSelection:false,diatonicMovement:false,octaveMovement:false,keySignatureEditing:false,noteNavigation:false,noteValueEditing:false,tempoEditing:false,measureLengthEditing:false,notePositionEditing:false,meterEditing:false};
function initial(){const project=ScoreProjectFactory.create();return {project,outlineCursor:createOutlineCursor(project.outline),timelineCursor:createTimelineCursor(),mode:'outline'};}
function press(s,key,held={},extra={}){return WorkspaceKeyboard.control(s,{key,code:'',repeat:false,shiftKey:false,...extra},{...holds,...held});}
function placed(){let s=initial();s=press(s,'a');s=press(s,'a');s=press(s,'r');return press(s,'a');}
test('workspace routing adds local measures and synchronizes note placement and mode transitions without mutating input',()=>{
 const first=initial(),before=structuredClone(first);let s=press(first,'a');assert.deepEqual(first,before);assert.equal(s.outlineCursor.blockId,first.outlineCursor.blockId);
 s=press(s,'r');assert.equal(s.mode,'timeline');s=press(s,'a');assert.ok(s.timelineCursor.focusedNoteId);assert.equal(s.outlineCursor.blockId,ScoreTimeline.notes(s.project.outline)[0].measure.id);
 const out=press(s,'r');assert.equal(out.mode,'outline');assert.equal(out.timelineCursor.selectionAnchorNoteId,null);
 assert.equal(press(initial(),'r').mode,'outline');assert.equal(press(s,'r',{}, {repeat:true}).mode,'timeline');
 assert.equal(press(s,'unbound').handled,false);
});
test('workspace input preserves note focus, bypass navigation and input unit when leaving a note',()=>{
 let s=placed();const id=s.timelineCursor.focusedNoteId;
 s=press(s,'1',{}, {shiftKey:true});assert.equal(s.timelineCursor.placementValue.type,'16th');
 s=press(s,'ArrowRight');assert.equal(s.timelineCursor.focusedNoteId,null);assert.equal(s.timelineCursor.positionSixteenths,4);
 s=press(s,'ArrowLeft');assert.equal(s.timelineCursor.focusedNoteId,id);assert.equal(s.timelineCursor.positionSixteenths,0);
 s=press(s,'ArrowRight');s=press(s,'ArrowLeft',{rangeSelection:true},{shiftKey:true});assert.equal(s.timelineCursor.focusedNoteId,null);assert.equal(s.timelineCursor.positionSixteenths,3);
 assert.equal(s.timelineCursor.placementValue.type,'16th');
});
test('held resize, duplication and pitch selection retain their routing precedence',()=>{
 let s=placed();const id=s.timelineCursor.focusedNoteId;
 s=press(s,'ArrowRight',{noteValueEditing:true});assert.equal(ScoreTimeline.note(s.project.outline,id).lengthSixteenths,8);
 s=press(s,'a',{notePositionEditing:true});assert.equal(ScoreTimeline.notes(s.project.outline).length,2);
 s=press(s,'a',{pitchSelection:true,noteValueEditing:true});assert.equal(ScoreTimeline.note(s.project.outline,s.timelineCursor.focusedNoteId).note.pitches.length,2);
 const count=ScoreTimeline.notes(s.project.outline).length;s=press(s,'a',{diatonicMovement:true});assert.equal(ScoreTimeline.notes(s.project.outline).length,count);
});
test('staff and local voice changes preserve position and unit while resetting the intended editing state',()=>{
 let s=placed();s=press(s,'1',{}, {shiftKey:true});const pos=s.timelineCursor.positionSixteenths;
 s=press(s,'q',{}, {shiftKey:true});assert.equal(s.timelineCursor.voiceIndex,0);
 s=press(s,'q');assert.equal(s.timelineCursor.voiceIndex,1);assert.equal(s.timelineCursor.focusedNoteId,null);
 s=press(s,'r',{}, {shiftKey:true});assert.equal(s.timelineCursor.staff,'lowerStaff');assert.equal(s.timelineCursor.voiceIndex,0);assert.equal(s.timelineCursor.positionSixteenths,pos);assert.equal(s.timelineCursor.placementValue.type,'16th');
 s=press(s,'r');s=press(s,'r');assert.equal(s.timelineCursor.staff,'upperStaff');assert.equal(s.timelineCursor.voiceIndex,0);
});
test('outline held edits consume navigation before mode switching or adding blocks',()=>{
 let s=initial();s=press(s,'a');const before=s.project.outline.length;
 const suppressed=press(s,'a',{keySignatureEditing:true});assert.equal(suppressed.project.outline.length,before);assert.equal(suppressed.handled,true);
 assert.equal(press(s,'r',{tempoEditing:true}).mode,'outline');
 const key=press({...s,outlineCursor:{blockId:s.project.outline[0].id}},'ArrowRight',{keySignatureEditing:true});assert.notDeepEqual(key.project,s.project);
 const init=press({...s,outlineCursor:{blockId:s.project.outline[0].id}},'Delete');assert.equal(init.project,s.project);
});
test('navigation alone resets a missing local voice when crossing into another measure',()=>{
 let s=placed();s=press(s,'q',{}, {shiftKey:true});s=press(s,'q');
 const synced=EditorNavigation.sync(s.project.outline,s.outlineCursor,{...s.timelineCursor,positionSixteenths:16});
 assert.equal(synced.timelineCursor.voiceIndex,0);assert.equal(synced.outlineCursor.blockId,s.project.outline.at(-1).id);
});
