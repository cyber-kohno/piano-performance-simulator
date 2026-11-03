import assert from 'node:assert/strict';
import {test} from 'node:test';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import RestSpelling from '../src/domain/score/rest-spelling.ts';
import ScoreTempo from '../src/domain/score/score-tempo.ts';
import ScoreClef from '../src/domain/score/score-clef.ts';
import ScoreSlur from '../src/domain/score/score-slur.ts';
import ScoreTrill from '../src/domain/score/score-trill.ts';
import ScoreClock from '../src/domain/performance/score-clock.ts';
import TrillPerformance from '../src/domain/performance/trill-performance.ts';
import ArpeggioPerformance from '../src/domain/performance/arpeggio-performance.ts';
import TrillPitch from '../src/domain/theory/trill-pitch.ts';
import VoiceCollision from '../src/domain/score/voice-collision.ts';
function fixture(){
 const p=ScoreProjectFactory.create();p.outline[0].data.tempo=120;
 const data=ScoreMeasure.create({unit:4,cnt:4});
 data.upperStaff.voices[0].elements=[
  {id:'a',kind:'note',value:{type:'quarter',dots:0},pitches:[{midi:69}],tieTo:'b'},
  {id:'b',kind:'note',value:{type:'quarter',dots:0},pitches:[{midi:69}],tieFrom:'a'},
  ...RestSpelling.create(8,8)];
 p.outline.push({id:'m',type:'measure',data});return p;
}
test('performance clock integrates an interior tempo change across one sustained tie range',()=>{
 const p=ScoreTempo.set(fixture(),'b',60),before=structuredClone(p);
 assert.equal(ScoreClock.secondsAt(p,4),0.5);assert.equal(ScoreClock.secondsAt(p,8),1.5);
 const auxiliary=TrillPitch.above(69,{fifths:-1},'diatonic');assert.equal(auxiliary.midi,70);
 const duration=ScoreClock.secondsAt(p,8)-ScoreClock.secondsAt(p,0);
 const attacks=TrillPerformance.attacks(69,auxiliary.midi,ScoreTrill.defaults,duration);
 assert.equal(attacks.length,8);assert.equal(attacks[1].offset,1.5/8);assert.equal(attacks[1].midi,70);
 assert.deepEqual(p,before); // event generation never writes metrical attacks into the score
});
test('arpeggio performance retains negative preroll offsets and does not mutate a saved chord',()=>{
 const pitches=[{midi:60},{midi:64},{midi:67}],before=structuredClone(pitches);
 const result=ArpeggioPerformance.attacks(pitches,{type:'down',spreadRatio:1,timing:1},0.15);
 assert.deepEqual(result.map(e=>e.midi),[67,64,60]);assert.ok(Math.abs(result[0].offset+0.1)<1e-12);assert.equal(result.at(-1).offset,0);
 assert.deepEqual(pitches,before);
});
test('score-owned metadata remains independently editable and reconciles deleted anchors without a renderer',()=>{
 let p=fixture();p=ScoreTempo.set(p,'b',90);p=ScoreClef.set(p,'b','bass');p=ScoreSlur.add(p,['a','b']);p=ScoreTrill.set(p,'b',ScoreTrill.defaults);
 assert.equal(ScoreTrill.forNote(p,'a').settings.attackCount,8);assert.equal(ScoreSlur.ranges(p).length,1);
 const before=p;const data=structuredClone(p.outline[2].data);data.upperStaff.voices[0].elements=[...RestSpelling.create(0,16)];
 p={...p,outline:[...p.outline.slice(0,2),{...p.outline[2],data}]};
 p=ScoreSlur.reconcile(ScoreClef.reconcile(ScoreTempo.reconcile(ScoreTrill.reconcile(before,p))));
 assert.equal(p.trills,undefined);assert.equal(p.slurs.length,0);assert.equal(p.clefChanges.length,0);assert.equal(p.tempoChanges.length,0);
});
test('collision rules are score constraints, including half-open boundary contact across staffs',()=>{
 const p=fixture(),span={staff:'lowerStaff',voiceId:'voice-0',startSixteenths:0,lengthSixteenths:4,pitches:[{midi:69}]};
 assert.equal(VoiceCollision.exists(p.outline,[span]),true);
 assert.equal(VoiceCollision.exists(p.outline,[{...span,startSixteenths:8}]),false);
 assert.equal(VoiceCollision.exists(p.outline,[{...span,pitches:[{midi:70}]}]),false);
});
