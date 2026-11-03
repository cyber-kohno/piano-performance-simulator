import assert from 'node:assert/strict';
import {test} from 'node:test';
import PedalInput from '../src/state/pedal-input.ts';
import TimelineView from '../src/state/timeline-view.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import NoteContinuation from '../src/domain/score/note-continuation.ts';
import TupletNotes from '../src/domain/score/tuplet-notes.ts';
import {createPedalCursor} from '../src/state/pedal.ts';
function fixture(meter={unit:4,cnt:4}){const p=ScoreProjectFactory.create();p.outline[0].data.timeSignature=meter;p.outline.push({id:'m',type:'measure',data:ScoreMeasure.create(meter)});return p;}
const input=(key,extra={})=>({key,code:'',shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,isComposing:false,...extra});
test('pedal keys emit musical edit requests without modifying the score and preserve unit and modifier behavior',()=>{
 const p=fixture(),before=structuredClone(p),c=createPedalCursor();
 assert.deepEqual(PedalInput.control(p,c,input('a')).command,{type:'add',position:0,action:'start'});
 assert.equal(PedalInput.control(p,c,input('s')).command.action,'stop');
 assert.equal(PedalInput.control(p,c,input('S',{shiftKey:true})).command.action,'change');
 assert.deepEqual(PedalInput.control(p,c,input('Delete')).command,{type:'remove',position:0});
 const changed=PedalInput.control(p,c,input('$',{code:'Digit4',shiftKey:true})).cursor;
 assert.deepEqual(changed.value,{type:'32nd',dots:0});assert.equal(changed.position,0);
 assert.equal(PedalInput.control(p,c,input('.')).command,undefined);
 for(const modifier of ['ctrlKey','altKey','metaKey','isComposing'])assert.equal(PedalInput.control(p,c,input('a',{[modifier]:true})).handled,false);
 assert.deepEqual(p,before);
});
test('pedal movement synchronizes outline at the final boundary and Escape only requests exit',()=>{
 const p=fixture(),c={...createPedalCursor(),position:12};
 const end=PedalInput.control(p,c,input('ArrowRight'));assert.equal(end.cursor.position,16);assert.equal(end.outlineBlockId,'section-0');
 assert.equal(PedalInput.control(p,end.cursor,input('ArrowRight')).cursor.position,16);
 const exit=PedalInput.control(p,end.cursor,input('Escape'));assert.equal(exit.exit,true);assert.equal(exit.cursor,end.cursor);
 assert.equal(PedalInput.control(p,createPedalCursor(),input('ArrowLeft')).cursor.position,0);
});
test('timeline header preserves compound beats, sixteenth subdivisions and irregular measure widths',()=>{
 const p=fixture({unit:8,cnt:6});p.outline.at(-1).data.length={unit:8,cnt:3};
 const header=TimelineView.header(p.outline,480)[0];assert.equal(header.width,180);assert.equal(header.ticks.length,6);
 assert.equal(header.ticks[2].kind,'eighth');assert.equal(header.ticks[1].kind,'sixteenth');
 p.outline.at(-1).data.length={unit:8,cnt:6};const compound=TimelineView.header(p.outline,480)[0];assert.equal(compound.ticks[6].kind,'beat');assert.equal(compound.width,360);
 p.outline[0].data.timeSignature={unit:4,cnt:3};assert.equal(TimelineView.header(p.outline,480)[0].ticks[4].kind,'beat');
});
test('timeline note geometry separates independent attacks but keeps ties and fractional tuplets continuous',()=>{
 const scope={staff:'upperStaff',voiceIndex:0},p=fixture(),v={type:'quarter',dots:0};
 const first=NoteContinuation.place(p,scope,0,v,60),target={...scope,noteId:first.noteId,pitchIndex:0};
 const copied=NoteContinuation.after(first.project,target,v,false);assert.ok(TimelineView.visualGaps(copied.project.outline).has(first.noteId));
 const notes=TimelineView.notes(copied.project.outline,4,30)[0];assert.equal(notes[0].displayLength,4-4/30);assert.equal(notes[1].displayLength,4);
 const tied=NoteContinuation.after(first.project,target,v,true);assert.equal(TimelineView.visualGaps(tied.project.outline).has(first.noteId),false);
 const converted=TupletNotes.convert(first.project,{...scope,noteId:first.noteId,position:0});assert.equal(TimelineView.notes(converted.project.outline,4,30)[0][0].length,4/3);
 assert.equal(TimelineView.notes(p.outline,4,30)[0].length,0);
});
