import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { addPedalEvent } from '../src/state/pedal.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
import { getPedalPreviewX, getPedalPreviewPaths } from '../src/model/score-preview-pedal.ts';
function score() {
  const p=createProject();
  for(let i=0;i<6;i++) p.outline.push({id:`m${i}`,type:'measure',data:createMeasureData({cnt:4,unit:4})});
  return p;
}
function withEvents(events) {
  let p=score();
  for(const [position,action] of events) p=addPedalEvent(p,position,action);
  return p;
}
test('preview XML includes independent pedal offsets, lower staff placement and retakes without changing notes', () => {
  const p=withEvents([[1,'start'],[3,'change'],[9,'stop']]);
  const original=structuredClone(p);
  const preview=createScorePreview(p.outline,0);
  const directions=[...preview.xml.matchAll(/<direction placement="below">(.*?)<\/direction>/g)].map(m=>m[1]);
  assert.equal(directions.length,3);
  assert.match(directions[0],/<pedal type="start" line="yes" sign="no" number="1"\/>.*<offset>2<\/offset><staff>2<\/staff>/);
  assert.match(directions[1],/<pedal type="change".*<offset>6<\/offset>/);
  assert.match(directions[2],/<pedal type="stop".*<offset>18<\/offset>/);
  assert.equal((preview.xml.match(/<note>/g)||[]).length,4);
  assert.deepEqual(p,original);
});
test('pedal-only fractional positions increase divisions to keep all XML durations integral', () => {
  const preview=createScorePreview(withEvents([[1/3,'start'],[2/3,'stop']]).outline,0);
  assert.match(preview.xml,/<divisions>24<\/divisions>/);
  assert.match(preview.xml,/<offset>2<\/offset>/);
  assert.match(preview.xml,/<offset>4<\/offset>/);
  assert.doesNotMatch(preview.xml,/<(?:offset|duration)>\d+\.\d+/);
});
test('window clips a held pedal with resume/discontinue instead of inventing presses or releases', () => {
  const p=withEvents([[4,'start'],[68,'change'],[80,'stop']]);
  const original=structuredClone(p);
  const preview=createScorePreview(p.outline,2); // measures 2,3,4
  assert.deepEqual(preview.pedals,[
    {measureOffset:0,position:0,type:'resume'},
    {measureOffset:2,position:16,type:'discontinue'},
  ]);
  assert.match(preview.xml,/<pedal type="resume"/);
  assert.match(preview.xml,/<pedal type="discontinue"/);
  assert.doesNotMatch(preview.xml,/<pedal type="(?:start|stop)"/);
  assert.deepEqual(p,original);
});
test('real stop at score end remains a release, but an open pedal has an open end', () => {
  const closed=createScorePreview(withEvents([[4,'start'],[96,'stop']]).outline,5);
  assert.deepEqual(closed.pedals,[{measureOffset:0,position:0,type:'resume'},{measureOffset:1,position:16,type:'stop'}]);
  const open=createScorePreview(withEvents([[4,'start']]).outline,5);
  assert.equal(open.pedals.at(-1).type,'discontinue');
});
test('a release exactly at the left window boundary does not draw a zero-length pedal', () => {
  const p=withEvents([[0,'start'],[16,'stop']]);
  assert.deepEqual(createScorePreview(p.outline,2).pedals,[]);
});
test('a boundary retake resumes the clipped line, and future pedals do not leak into the window', () => {
  const p=withEvents([[0,'start'],[16,'change'],[64,'stop']]);
  const preview=createScorePreview(p.outline,2);
  assert.equal(preview.pedals[0].type,'resume');
  assert.equal(preview.pedals.filter(e=>e.position===0 && e.measureOffset===0).length,1);
  assert.deepEqual(createScorePreview(withEvents([[80,'start']]).outline,0).pedals,[]);
});
const layout={length:16,startX:20,endX:200,anchors:[{position:0,x:24},{position:4,x:80},{position:8,x:160}]};
test('pedal time follows actual notation spacing and interpolates positions without noteheads', () => {
  assert.equal(getPedalPreviewX(layout,0),24);
  assert.equal(getPedalPreviewX(layout,2),52);
  assert.equal(getPedalPreviewX(layout,6),120);
  assert.equal(getPedalPreviewX(layout,16),200);
  assert.equal(getPedalPreviewX({...layout,anchors:[]},8),110);
});
test('SVG lines distinguish presses, retakes, releases and cropped continuation endpoints', () => {
  const event=(position,type)=>({measureOffset:0,position,type});
  assert.deepEqual(getPedalPreviewPaths([event(0,'start'),event(4,'change'),event(8,'stop')],[layout],100),
    ['M 24 93 L 24 100 L 76 100 L 80 93 L 84 100 L 160 100 L 160 93']);
  assert.deepEqual(getPedalPreviewPaths([event(0,'resume'),event(16,'discontinue')],[layout],100),['M 24 100 L 200 100']);
});
