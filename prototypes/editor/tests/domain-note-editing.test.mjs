import assert from 'node:assert/strict';
import {test} from 'node:test';
import NotePitches from '../src/domain/score/note-pitches.ts';
import NoteExpressions from '../src/domain/score/note-expressions.ts';
import RhythmSpelling from '../src/domain/score/rhythm-spelling.ts';
import PianoPitchRules from '../src/domain/score/piano-pitch-rules.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import RestSpelling from '../src/domain/score/rest-spelling.ts';
import WrittenValue from '../src/domain/theory/written-value.ts';
function fixture(){
 const p=ScoreProjectFactory.create(),data=ScoreMeasure.create({unit:4,cnt:4});
 data.upperStaff.voices[0].elements=[{kind:'note',id:'a',value:{type:'quarter',dots:0},pitches:[{midi:60,fingering:1}],tieTo:'b'},
 {kind:'note',id:'b',value:{type:'quarter',dots:0},pitches:[{midi:60,fingering:2}],tieFrom:'a'},...RestSpelling.create(8,8)];
 p.outline.push({id:'m',type:'measure',data});return p;
}
const target={noteId:'a',staff:'upperStaff',pitchIndex:0};
test('headless pitch movement follows the entire tie and preserves each segment fingering',()=>{
 const p=fixture(),before=structuredClone(p),result=NotePitches.move(p,target,1);
 assert.equal(result.midi,61);assert.equal(Object.hasOwn(result,'cursor'),false);
 assert.deepEqual(ScoreTimeline.tieChain(result.project.outline,'a').map(e=>e.note.pitches),[[{midi:61,fingering:1}],[{midi:61,fingering:2}]]);
 assert.deepEqual(p,before);
});
test('adding a chord pitch updates all segments, and pitch reorder returns the musical target index',()=>{
 const p=fixture(),chord=NotePitches.add(p,target);assert.equal(chord.midi,59);assert.equal(chord.pitchIndex,1);
 assert.deepEqual(ScoreTimeline.note(chord.project.outline,'b').note.pitches.map(p=>p.midi),[60,59]);
 const moved=NotePitches.move(chord.project,{...target,pitchIndex:1},1);
 assert.equal(moved.midi,61);assert.equal(moved.pitchIndex,0);assert.deepEqual(ScoreTimeline.note(moved.project.outline,'a').note.pitches.map(p=>p.midi),[61,60]);
});
test('headless edits reject other-staff pitch collisions, invalid targets, grace parents and range limits atomically',()=>{
 const p=fixture();p.outline[2].data.lowerStaff.voices[0].elements=[{kind:'note',id:'lower',value:{type:'quarter',dots:0},pitches:[{midi:59}]},...RestSpelling.create(4,12)];
 const before=structuredClone(p);assert.equal(NotePitches.add(p,target),undefined);
 assert.equal(NotePitches.move(p,{...target,noteId:'missing'},1),undefined);
 assert.equal(NotePitches.move(p,{...target,pitchIndex:9},1),undefined);assert.deepEqual(p,before);
 const grace=fixture();grace.outline[2].data.upperStaff.voices[0].elements[1].beforeGraceNotes=[{id:'g',value:{type:'eighth',dots:0},slash:true,pitches:[{midi:59}]}];
 assert.equal(NotePitches.add(grace,target),undefined);
 assert.equal(PianoPitchRules.next(108,1),undefined);assert.equal(PianoPitchRules.next(21,-1),undefined);
 assert.equal(PianoPitchRules.allowsChord([60,76]),false);
});
test('range transposition keeps intervals and repairs ties after partial musical targets change',()=>{
 const p=fixture(),result=NotePitches.transpose(p,'upperStaff',['a','b'],1);
 assert.equal(ScoreTimeline.tieChain(result.outline,'b').length,2);
 assert.equal(ScoreTimeline.note(result.outline,'a').note.pitches[0].midi,61);
 assert.equal(NotePitches.transpose(p,'upperStaff',['a','missing'],1),undefined);
 assert.equal(NotePitches.transpose(p,'upperStaff',['a'],1),undefined);
});
test('note expressions target an ID rather than selection state and retain exclusivity and tie constraints',()=>{
 const p=fixture(),before=structuredClone(p),staccato={type:'normal',lengthRatio:0.5};
 assert.equal(NoteExpressions.set(p,target,{staccato}),p);
 const tail={noteId:'b',staff:'upperStaff'};const marked=NoteExpressions.set(p,tail,{staccato});
 assert.deepEqual(ScoreTimeline.note(marked.outline,'b').note.staccato,staccato);
 assert.equal(NoteExpressions.set(marked,tail,{staccato:{...staccato,lengthRatio:0.55}}),marked);
 const removed=NoteExpressions.set(marked,tail,{});assert.equal(Object.hasOwn(ScoreTimeline.note(removed.outline,'b').note,'staccato'),false);
 assert.deepEqual(p,before);
});
test('rhythm spelling considers the onset, dotted values and compound beats without any cursor input',()=>{
 const simple={unit:4,cnt:4},compound={unit:8,cnt:6};
 assert.deepEqual(RhythmSpelling.spell(0,5,simple),[{type:'quarter',dots:0},{type:'16th',dots:0}]);
 assert.deepEqual(RhythmSpelling.spell(1,2,simple),[{type:'16th',dots:0},{type:'16th',dots:0}]);
 assert.deepEqual(RhythmSpelling.spell(6,6,compound),[{type:'quarter',dots:1}]);
 for(const [start,length,meter]of [[1,7,simple],[3,9,compound],[0,0.5,simple]]){
 const values=RhythmSpelling.spell(start,length,meter);assert.ok(values);assert.equal(values.reduce((sum,v)=>sum+WrittenValue.sixteenths(v),0),length);
 }
 assert.equal(RhythmSpelling.spell(0,0,simple),undefined);
});
