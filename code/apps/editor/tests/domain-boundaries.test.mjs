import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative } from 'node:path';
import MusicalTime from '../src/domain/theory/musical-time.ts';
import WrittenValue from '../src/domain/theory/written-value.ts';
import Meter from '../src/domain/theory/meter.ts';
import KeyTheory from '../src/domain/theory/key-signature.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreVoice from '../src/domain/score/score-voice.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import ScoreTies from '../src/domain/score/score-ties.ts';
import ScoreKey from '../src/domain/score/score-key.ts';
import RestSpelling from '../src/domain/score/rest-spelling.ts';

test('theory composes exact tuplet time, compound-meter beats and written notation without an editor',()=>{
 let t=MusicalTime.create(0);for(let i=0;i<3;i++)t=MusicalTime.add(t,MusicalTime.create(2,3));
 assert.deepEqual(t,MusicalTime.create(WrittenValue.sixteenths({type:'eighth',dots:0})));
 assert.deepEqual(Meter.beatLength({unit:8,cnt:6}),{unit:8,cnt:3});
 assert.deepEqual(Meter.beatLength({unit:4,cnt:3}),{unit:4,cnt:1});
 assert.equal(WrittenValue.sixteenths({type:'eighth',dots:1}),3);
 assert.equal(WrittenValue.label({type:'quarter',dots:1}),'1/4.');
 assert.equal(KeyTheory.pitchClasses({fifths:-1}).has(10),true);
 assert.equal(KeyTheory.pitchClasses({fifths:-1}).has(11),false);
});
test('a headless score derives tuplet onsets and voice coverage from written values alone',()=>{
 const project=ScoreProjectFactory.create();const data=ScoreMeasure.create({unit:4,cnt:4});
 const note=i=>({kind:'note',id:`n${i}`,value:{type:'eighth',dots:0},pitches:[{midi:60}]});
 data.upperStaff.voices[0].elements=[{kind:'tuplet',id:'t',actual:3,normal:2,baseType:'eighth',elements:[note(0),note(1),note(2)]},...RestSpelling.create(4,12)];
 project.outline.push({id:'m',type:'measure',data});
 const notes=ScoreTimeline.notes(project.outline);
 assert.deepEqual(notes.map(n=>MusicalTime.fromNumber(n.positionSixteenths)),[MusicalTime.create(0),MusicalTime.create(4,3),MusicalTime.create(8,3)]);
 const located=ScoreVoice.locate(data.upperStaff.voices[0],data.length);
 assert.equal(located.reduce((sum,e)=>sum+e.lengthSixteenths,0),16);
 assert.equal(ScoreTimeline.note(project.outline,'n1').tuplet.id,'t');
 assert.equal(ScoreTimeline.length(project.outline),16);
 assert.throws(()=>ScoreVoice.time({...data.upperStaff.voices[0].elements[0],elements:[note(0)]},data.length),/Incomplete/);
});
test('domain queries and tie validation handle cross-measure notes and local voices without a cursor',()=>{
 const p=ScoreProjectFactory.create();const note=(id,from,to)=>({kind:'note',id,value:{type:'whole',dots:0},pitches:[{midi:60}],...(from?{tieFrom:from}:{}),...(to?{tieTo:to}:{})});
 for(let i=0;i<2;i++){const data=ScoreMeasure.create({unit:4,cnt:4});data.upperStaff.voices[0].elements=[note(`n${i}`,i?'n0':null,i?null:'n1')];p.outline.push({id:`m${i}`,type:'measure',data})}
 assert.equal(ScoreTimeline.measureAt(p.outline,16).measure.id,'m1');
 assert.equal(ScoreTimeline.outlinePosition(p.outline,'m1'),16);
 assert.equal(ScoreTimeline.blockAt(p.outline,16).id,'m1');
 assert.equal(ScoreTimeline.tieChain(ScoreTies.reconcile(p.outline),'n1').length,2);
 p.outline[3].data.upperStaff.voices[0].elements[0].pitches[0].midi=61;
 const repaired=ScoreTies.reconcile(p.outline);assert.equal(ScoreTimeline.note(repaired,'n0').note.tieTo,undefined);
 assert.equal(ScoreTimeline.note(repaired,'n1').note.tieFrom,undefined);
});
test('key lookup and shared pitch-class caches derive from outline changes without selection state',()=>{
 const p=ScoreProjectFactory.create();p.outline.push({id:'m0',type:'measure',data:ScoreMeasure.create({unit:4,cnt:4})},{id:'k',type:'key-change',data:{keySignature:{fifths:-1}}},{id:'m1',type:'measure',data:ScoreMeasure.create({unit:4,cnt:4})});
 const cache=ScoreKey.buildMeasureCache(p.outline);
 assert.equal(ScoreKey.at(p.outline,15).fifths,0);assert.equal(ScoreKey.at(p.outline,16).fifths,-1);
 assert.equal(ScoreKey.contains(cache,'m0',71),true);assert.equal(ScoreKey.contains(cache,'m1',71),false);
});
test('domain dependency boundary rejects UI, legacy model/state and infrastructure dependencies',()=>{
 const src=fileURLToPath(new URL('../src/',import.meta.url)),domain=resolve(src,'domain');
 function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)])}
 for(const file of walk(domain).filter(p=>p.endsWith('.ts'))){
  const source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)){
   const spec=match[1];assert.ok(spec.startsWith('.'),`${file}: external dependency ${spec}`);
   const target=resolve(dirname(file),spec);assert.ok(relative(domain,target).split(/[\\/]/)[0]!=='..',`${file}: outward dependency ${spec}`);
   if(file.includes(`${resolve(domain,'theory')}`))assert.ok(!target.startsWith(resolve(domain,'score')),`${file}: theory must not depend on score`);
   if(file.startsWith(resolve(domain,'theory')) || file.startsWith(resolve(domain,'score')))
    assert.ok(!target.startsWith(resolve(domain,'performance')),`${file}: notation must not depend on performance`);
  }
 }
});
