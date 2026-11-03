import assert from 'node:assert/strict';
import {test} from 'node:test';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import NoteContinuation from '../src/domain/score/note-continuation.ts';
import GraceNotes from '../src/domain/score/grace-notes.ts';
import TupletNotes from '../src/domain/score/tuplet-notes.ts';
const scope={staff:'upperStaff',voiceIndex:0};
const quarter={type:'quarter',dots:0};
function fixture(){const p=ScoreProjectFactory.create();p.outline.push({id:'m',type:'measure',data:ScoreMeasure.create({unit:4,cnt:4})});return p;}
function placed(){const r=NoteContinuation.place(fixture(),scope,0,quarter,60);return {project:r.project,target:{...scope,noteId:r.noteId,pitchIndex:0}};}
test('grace mutations use explicit parents, preserve order and remove the optional field without changing score time',()=>{
 const {project,target}=placed(),before=structuredClone(project);
 const a=GraceNotes.add(project,target,null),b=GraceNotes.add(a.project,target,a.graceId);
 assert.deepEqual(ScoreTimeline.note(b.project.outline,target.noteId).note.beforeGraceNotes.map(n=>n.pitches[0].midi),[59,58]);
 const moved=GraceNotes.movePitch(b.project,target,b.graceId,1,{fifths:0});assert.equal(moved.pitch,59);
 const removed=GraceNotes.remove(GraceNotes.remove(moved.project,target,a.graceId),target,b.graceId);
 assert.equal('beforeGraceNotes' in ScoreTimeline.note(removed.outline,target.noteId).note,false);
 assert.equal(ScoreTimeline.note(removed.outline,target.noteId).lengthSixteenths,4);assert.deepEqual(project,before);
 assert.equal(GraceNotes.add(project,{...target,voiceIndex:1},null),undefined);
 assert.equal(GraceNotes.movePitch(project,target,'missing',1),undefined);
});
test('headless tuplet conversion, placement and resizing preserve exact voice coverage and collapse to the original note',()=>{
 const {project,target}=placed(),request={...scope,noteId:target.noteId,position:0};
 const converted=TupletNotes.convert(project,request);assert.equal('cursor' in converted,false);
 const group=TupletNotes.context(converted.project.outline,request);assert.equal(group.step,4/3);
 const added=TupletNotes.add(converted.project,request,group.step,62);assert.ok(added);
 assert.equal(TupletNotes.add(added.project,request,group.step,64),undefined);
 const grown=TupletNotes.resize(converted.project,request,1),collapsed=TupletNotes.resize(grown.project,request,1);
 assert.equal(ScoreTimeline.note(collapsed.project.outline,target.noteId).tuplet,undefined);
 assert.equal(ScoreTimeline.note(collapsed.project.outline,target.noteId).lengthSixteenths,4);
 const m=added.project.outline.at(-1);assert.equal(ScoreVoice.locate(m.data.upperStaff.voices[0],m.data.length).reduce((sum,e)=>sum+e.lengthSixteenths,0),16);
});
test('headless tuplet selection moves internally until both temporal edges are selected',()=>{
 const {project,target}=placed(),request={...scope,noteId:target.noteId,position:0};
 const converted=TupletNotes.convert(project,request);
 const internal=TupletNotes.move(converted.project,request,new Set([target.noteId]),1,4);
 assert.equal(internal.position,4/3);
 assert.equal(TupletNotes.move(internal.project,{...request,position:internal.position},new Set([target.noteId]),-1,4).position,0);
 assert.equal(TupletNotes.move(converted.project,request,new Set([target.noteId]),-1,4),undefined);
});
test('continuations preserve chord pitches and grace copies while ties and independent copies remain distinct',()=>{
 const {project,target}=placed();const grace=GraceNotes.add(project,target,null);
 const copy=NoteContinuation.after(grace.project,target,quarter,false);
 const note=ScoreTimeline.note(copy.project.outline,copy.noteId).note;
 assert.equal(note.tieFrom,undefined);assert.equal(note.beforeGraceNotes[0].pitches[0].midi,59);assert.notEqual(note.beforeGraceNotes[0].id,grace.graceId);
 const tied=NoteContinuation.after(project,target,quarter,true);
 assert.equal(ScoreTimeline.tieChain(tied.project.outline,target.noteId).length,2);
 assert.equal(NoteContinuation.after(tied.project,target,quarter,true),undefined);
 const detached=NoteContinuation.toggleAdjacent(tied.project,target);assert.equal(ScoreTimeline.tieChain(detached.outline,target.noteId).length,1);
 assert.equal(NoteContinuation.after(project,{...target,voiceIndex:2},quarter,false),undefined);
});
