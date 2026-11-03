import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { addPedalEvent, deletePedalEvent, getPedalEvents, getPedalSpans, createPedalCursor, movePedalCursor } from '../src/state/pedal.ts';
function score() {
  const project = createProject();
  for (let i=0; i<3; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({cnt:4,unit:4}) });
  return project;
}
const events = project => getPedalEvents(project).map(({ position, action }) => [position, action]);
test('independent pedal events cross bars, persist local rational offsets and accept a score-end stop', () => {
  let p = score();
  p = addPedalEvent(p, 4, 'start');
  p = addPedalEvent(p, 18, 'change');
  assert.deepEqual(getPedalSpans(p), [{start:4,end:48}]);
  assert.deepEqual(p.outline[3].data.pedalEvents[0].offset, {numerator:2,denominator:1});
  p = addPedalEvent(p, 48, 'stop');
  assert.deepEqual(events(p), [[4,'start'],[18,'change'],[48,'stop']]);
  assert.deepEqual(getPedalSpans(p), [{start:4,end:48}]);
});
test('pedal state rejects invalid or duplicate events without altering notes', () => {
  const p = score();
  assert.equal(addPedalEvent(p, 0, 'stop'), p);
  assert.equal(addPedalEvent(p, 0, 'change'), p);
  assert.equal(addPedalEvent(p, 48, 'start'), p);
  const down = addPedalEvent(p, 0, 'start');
  assert.equal(addPedalEvent(down, 4, 'start'), down);
  assert.equal(addPedalEvent(down, 0, 'stop'), down);
  assert.equal(down.outline[2].data.upperStaff, p.outline[2].data.upperStaff);
});
test('deleting a start removes through its stop, but preserves subsequent spans', () => {
  let p = score();
  for (const [position, action] of [[0,'start'],[4,'change'],[8,'stop'],[12,'start'],[20,'stop']]) p=addPedalEvent(p,position,action);
  p=deletePedalEvent(p,0);
  assert.deepEqual(events(p), [[12,'start'],[20,'stop']]);
});
test('deleting a stop merges spans and removes the redundant next start, retaining changes', () => {
  let p = score();
  for (const [position, action] of [[0,'start'],[4,'change'],[8,'stop'],[12,'start'],[16,'change'],[20,'stop']]) p=addPedalEvent(p,position,action);
  p=deletePedalEvent(p,8);
  assert.deepEqual(events(p), [[0,'start'],[4,'change'],[16,'change'],[20,'stop']]);
  assert.deepEqual(getPedalSpans(p), [{start:0,end:20}]);
  p=deletePedalEvent(p,16);
  assert.deepEqual(events(p), [[0,'start'],[4,'change'],[20,'stop']]);
});
test('pedal cursor clamps to score bounds and uses its own undotted note unit', () => {
  const p=score();
  let cursor=createPedalCursor();
  assert.equal(movePedalCursor(p,cursor,-1).position,0);
  cursor=movePedalCursor(p,cursor,1);
  assert.equal(cursor.position,4);
  cursor={position:47.5,value:{type:'quarter',dots:0}};
  assert.equal(movePedalCursor(p,cursor,1).position,48);
  cursor={position:0,value:{type:'32nd',dots:0}};
  assert.equal(movePedalCursor(p,cursor,1).position,.5);
});
test('placing an earlier stop trims changes and the previous stop; an earlier start merges the next span', () => {
  let p=score();
  for (const [position,action] of [[4,'start'],[12,'change'],[20,'stop']]) p=addPedalEvent(p,position,action);
  p=addPedalEvent(p,8,'stop');
  assert.deepEqual(events(p), [[4,'start'],[8,'stop']]);
  p=addPedalEvent(p,0,'start');
  assert.deepEqual(events(p), [[0,'start'],[8,'stop']]);
});
test('deleting a measure discards orphan pedal events; shortening cannot leave events outside the bar', async () => {
  const { deleteOutlineBlock, changeOutlineMeasureBeats } = await import('../src/state/outline-cursor.ts');
  let p=score();
  for (const [position,action] of [[0,'start'],[20,'change'],[24,'stop']]) p=addPedalEvent(p,position,action);
  const removed=deleteOutlineBlock(p.outline,{blockId:'m0'});
  assert.deepEqual(events({outline:removed.outline}),[]);
  p=addPedalEvent(score(),15,'start');
  assert.equal(changeOutlineMeasureBeats(p.outline,{blockId:'m0'},-1),p.outline);
});
test('fractional pedal offsets remain exact and deleting an open start removes its changes', () => {
  let p=addPedalEvent(score(),1/3,'start');
  p=addPedalEvent(p,2/3,'change');
  assert.deepEqual(p.outline[2].data.pedalEvents[0].offset,{numerator:1,denominator:3});
  assert.deepEqual(events(deletePedalEvent(p,1/3)),[]);
});
test('pedal shading segments restart at every retake without changing stored events or logical spans', () => {
  let p=score();
  for(const [position,action] of [[0,'start'],[4,'change'],[20,'change'],[24,'stop'],[28,'start'],[36,'change']]) p=addPedalEvent(p,position,action);
  const original=structuredClone(p);
  assert.deepEqual(getPedalSpans(p,{splitAtChanges:true}),[
    {start:0,end:4},{start:4,end:20},{start:20,end:24},{start:28,end:36},{start:36,end:48},
  ]);
  assert.deepEqual(getPedalSpans(p),[{start:0,end:24},{start:28,end:48}]);
  assert.deepEqual(p,original);
});
