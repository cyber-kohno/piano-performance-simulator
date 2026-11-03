import assert from 'node:assert/strict';
import {test} from 'node:test';
import ScoreOutline from '../src/domain/score/score-outline.ts';
import ScorePedal from '../src/domain/score/score-pedal.ts';
import ScoreStaff from '../src/domain/score/score-staff.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import NotePlacement from '../src/domain/score/note-placement.ts';
const quarter={type:'quarter',dots:0};
function fixture(){const p=ScoreProjectFactory.create();p.outline=ScoreOutline.addMeasure(p.outline,p.outline[1].id).outline;return p;}
test('headless outline edits keep required structure and use musical meter parameters rather than keys',()=>{
 const p=ScoreProjectFactory.create(),before=structuredClone(p),id=p.outline[0].id;
 const compound=ScoreOutline.changeMeter(p.outline,id,'denominator',1);assert.deepEqual(compound[0].data.timeSignature,{unit:8,cnt:12});
 const shorter=ScoreOutline.changeMeter(compound,id,'numerator',-1);assert.deepEqual(shorter[0].data.timeSignature,{unit:8,cnt:9});
 const added=ScoreOutline.addMeasure(shorter,shorter[1].id);assert.equal(added.blockId,shorter[1].id);assert.equal(added.outline.at(-1).type,'measure');
 assert.equal(ScoreOutline.changeMeter(added.outline,id,'numerator',-1),added.outline);
 assert.equal(ScoreOutline.remove(added.outline,id).outline,added.outline);assert.equal(ScoreOutline.remove(added.outline,shorter[1].id).outline,added.outline);assert.deepEqual(p,before);
});
test('local voice creation changes only its measure and staff and enforces the three-voice limit',()=>{
 const p=fixture();p.outline=ScoreOutline.addMeasure(p.outline,p.outline.at(-1).id).outline;
 const m=p.outline[2],before=structuredClone(p);const two=ScoreStaff.addVoice(p,m.id,'upperStaff',0);
 assert.equal(two.outline[2].data.upperStaff.voices.length,2);assert.equal(two.outline[3],p.outline[3]);assert.equal(two.outline[2].data.lowerStaff,p.outline[2].data.lowerStaff);
 assert.equal(ScoreStaff.addVoice(two,m.id,'upperStaff',0),two);const three=ScoreStaff.addVoice(two,m.id,'upperStaff',1);
 assert.equal(ScoreStaff.addVoice(three,m.id,'upperStaff',2),three);assert.deepEqual(p,before);
});
test('independent pedal events keep exact fractional offsets and deletion removes the owned span',()=>{
 const p=fixture(),before=structuredClone(p);let next=ScorePedal.add(p,1/3,'start');next=ScorePedal.add(next,4,'change');next=ScorePedal.add(next,16,'stop');
 assert.deepEqual(next.outline[2].data.pedalEvents[0].offset,{numerator:1,denominator:3});
 assert.deepEqual(ScorePedal.spans(next,{splitAtChanges:true}),[{start:1/3,end:4},{start:4,end:16}]);
 assert.equal(ScorePedal.add(p,2,'stop'),p);assert.equal(ScorePedal.add(next,17,'start'),next);
 assert.equal(ScorePedal.events(ScorePedal.remove(next,1/3)).length,0);assert.deepEqual(p,before);
});
test('measure removal repairs pedal ownership and shortening rejects notes instead of truncating them',()=>{
 let p=fixture();p.outline=ScoreOutline.addMeasure(p.outline,p.outline.at(-1).id).outline;
 p=ScorePedal.add(p,0,'start');p=ScorePedal.add(p,20,'stop');
 const removed=ScoreOutline.remove(p.outline,p.outline[2].id);assert.equal(ScorePedal.events({outline:removed.outline}).length,0);
 const placed=NotePlacement.add(p,{staff:'upperStaff',voiceIndex:0},12,quarter,60).project;
 assert.equal(ScoreOutline.changeMeasureBeats(placed.outline,placed.outline[2].id,-1),placed.outline);
});
