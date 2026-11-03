import assert from 'node:assert/strict';
import {test} from 'node:test';
import NotePlacement from '../src/domain/score/note-placement.ts';
import NoteDuration from '../src/domain/score/note-duration.ts';
import NoteMovement from '../src/domain/score/note-movement.ts';
import NoteDeletion from '../src/domain/score/note-deletion.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreNotes from '../src/domain/score/score-notes.ts';
import RestSpelling from '../src/domain/score/rest-spelling.ts';
const scope={staff:'upperStaff',voiceIndex:0};
const value=(type='quarter')=>({type,dots:0});
const target=id=>({...scope,noteId:id,pitchIndex:0});
function blank(){const p=ScoreProjectFactory.create();for(let i=0;i<3;i++)p.outline.push({id:`m${i}`,type:'measure',data:ScoreMeasure.create({unit:4,cnt:4})});return p}
function chain(){let a=NotePlacement.add(blank(),scope,12,value(),60),b=NotePlacement.add(a.project,scope,16,value(),60);const project=ScoreNotes.map(b.project,new Set([a.noteId,b.noteId]),n=>n.id===a.noteId?{...n,tieTo:b.noteId}:{...n,tieFrom:a.noteId},scope.staff);return {project,a:a.noteId,b:b.noteId}}
function covered(p){for(const m of p.outline.filter(b=>b.type==='measure'))for(const staff of [m.data.upperStaff,m.data.lowerStaff])for(const voice of staff.voices){const entries=ScoreVoice.flatten(voice,m.data.length);assert.equal(entries.reduce((sum,e)=>sum+e.lengthSixteenths,0),m.data.length.cnt/m.data.length.unit*16)}}
test('headless placement and explicit value changes preserve rest coverage and never persist an onset',()=>{
 const p=blank(),before=structuredClone(p),placed=NotePlacement.add(p,scope,1,value('16th'),60);
 assert.equal(placed.position,1);assert.equal(Object.hasOwn(placed,'cursor'),false);
 const changed=NoteDuration.setValue(placed.project,target(placed.noteId),value());assert.equal(changed.position,1);
 assert.equal(ScoreTimeline.note(changed.project.outline,placed.noteId).lengthSixteenths,4);
 assert.equal(Object.hasOwn(ScoreTimeline.note(changed.project.outline,placed.noteId).note,'position'),false);
 assert.deepEqual(p,before);covered(changed.project);
});
test('headless normalization grows a tie across bars, preserves source identity and blocks score-end and zero duration',()=>{
 const s=chain(),before=structuredClone(s.project),result=NoteDuration.normalize(s.project,target(s.b),1,4);
 const notes=ScoreTimeline.tieChain(result.project.outline,result.noteId);
 assert.equal(notes[0].note.id,s.a);assert.equal(result.noteId,s.b);
 assert.equal(notes.reduce((sum,n)=>sum+n.lengthSixteenths,0),12);covered(result.project);assert.deepEqual(s.project,before);
 assert.equal(NoteDuration.setValue(s.project,target(s.a),value('half')),undefined);
 assert.equal(NoteDuration.normalize(s.project,target(s.b),-1,8),undefined);
 assert.equal(NoteDuration.normalize(s.project,target(s.b),1,100),undefined);
});
test('moving one member moves the ordinary tie as one musical target; movement cannot sweep past stationary notes',()=>{
 const s=chain(),moved=NoteMovement.move(s.project,target(s.b),[s.b],4);
 assert.equal(ScoreTimeline.note(moved.project.outline,s.a).measureStartSixteenths+ScoreTimeline.note(moved.project.outline,s.a).positionSixteenths,16);
 assert.equal(ScoreTimeline.tieChain(moved.project.outline,s.a).length,2);covered(moved.project);
 let a=NotePlacement.add(blank(),scope,0,value('eighth'),60),b=NotePlacement.add(a.project,scope,4,value('eighth'),64);
 assert.equal(NoteMovement.move(b.project,target(a.noteId),[a.noteId],8),undefined);
});
test('pitch-only deletion edits the whole tie; segment deletion repairs links and leaves complete voices',()=>{
 const s=chain(),chord=ScoreNotes.map(s.project,new Set([s.a,s.b]),n=>({...n,pitches:[{midi:64},{midi:60}]}),scope.staff);
 const reduced=NoteDeletion.remove(chord,target(s.a),[s.a],true);assert.equal(reduced.noteId,s.a);assert.equal(reduced.pitch,60);
 assert.deepEqual(ScoreTimeline.note(reduced.project.outline,s.b).note.pitches,[{midi:60}]);
 const removed=NoteDeletion.remove(s.project,target(s.a),[s.a]);assert.equal(removed.noteId,undefined);assert.equal(removed.position,12);
 assert.equal(ScoreTimeline.note(removed.project.outline,s.b).note.tieFrom,undefined);covered(removed.project);
});
test('deleting the last tuplet note dissolves just its group and returns its musical boundary',()=>{
 const p=blank(),data=p.outline[2].data;
 data.upperStaff.voices[0].elements=[{kind:'tuplet',id:'g',actual:3,normal:2,baseType:'eighth',elements:[{kind:'rest',id:'r1',value:value('eighth')},{kind:'note',id:'t',value:value('eighth'),pitches:[{midi:60}]},{kind:'rest',id:'r2',value:value('eighth')}]},...RestSpelling.create(4,12)];
 const result=NoteDeletion.remove(p,target('t'),['t']);assert.equal(result.position,0);
 assert.equal(result.project.outline[2].data.upperStaff.voices[0].elements.some(e=>e.kind==='tuplet'),false);covered(result.project);
});
test('musical targets reject stale IDs, wrong voices, occupied destinations and cross-voice pitch collisions atomically',()=>{
 const a=NotePlacement.add(blank(),scope,0,value(),60),p=a.project,before=structuredClone(p);
 const wrong={...target(a.noteId),voiceIndex:1};
 assert.equal(NoteDuration.setValue(p,wrong,value('eighth')),undefined);assert.equal(NoteDuration.normalize(p,wrong,1,1),undefined);
 assert.equal(NoteMovement.move(p,wrong,[a.noteId],1),undefined);assert.equal(NoteDeletion.remove(p,wrong,[a.noteId]),undefined);
 assert.equal(NoteMovement.move(p,target(a.noteId),[a.noteId,'missing'],1),undefined);
 assert.equal(NoteDeletion.remove(p,target(a.noteId),[a.noteId,'missing']),undefined);
 assert.equal(NotePlacement.add(p,scope,0,value(),62),undefined);
 assert.equal(NotePlacement.add(p,{staff:'lowerStaff',voiceIndex:0},0,value(),60),undefined);
 assert.deepEqual(p,before);
});
