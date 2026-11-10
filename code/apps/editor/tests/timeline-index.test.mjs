import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData } from '../src/model/project.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import PreviewMusicXml from '../src/infra/musicxml/preview-musicxml.ts';

test('timeline index preserves boundary lookup across variable length measures and trailing sections', () => {
  const project = createProject();
  for (let i = 0; i < 120; i++) {
    project.outline.push({ id: `m-${i}`, type: 'measure', data: createMeasureData({ cnt: i % 3 + 1, unit: 4 }) });
  }
  project.outline.push({ id: 'tail', type: 'section', data: { name: 'Tail' } });
  const index = ScoreTimeline.index(project.outline);
  assert.equal(index.length, ScoreTimeline.length(project.outline));
  for (let position = -1; position <= index.length + 1; position += 0.5) {
    assert.equal(index.measureAt(position)?.measure.id, ScoreTimeline.measureAt(project.outline, position)?.measure.id);
    assert.equal(index.blockAt(position)?.id, ScoreTimeline.blockAt(project.outline, position)?.id);
  }
  for (const block of project.outline) {
    assert.equal(index.blockPositions.get(block.id), ScoreTimeline.outlinePosition(project.outline, block.id));
  }
});

test('prepared preview preserves incoming pedal state when jumping between windows', () => {
  const project = createProject();
  for (let i = 0; i < 12; i++) {
    const data = createMeasureData({ cnt: 4, unit: 4 });
    data.pedalEvents = i === 1 || i === 8
      ? [{ id: `p-${i}`, action: i === 1 ? 'start' : 'stop', offset: { numerator: 0, denominator: 1 } }] : [];
    project.outline.push({ id: `m-${i}`, type: 'measure', data });
  }
  const prepared = PreviewMusicXml.prepare(project.outline);
  assert.equal(prepared.incomingPedal[7], true);
  assert.equal(prepared.incomingPedal[9], false);
  for (const active of [10, 3, 8, 0, 6]) {
    assert.deepEqual(PreviewMusicXml.create(project.outline, active, [], [], [], [], [], prepared),
      PreviewMusicXml.create(project.outline, active));
  }
});
