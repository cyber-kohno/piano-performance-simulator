import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeasureData, createProject } from '../src/model/project.ts';
import { createTimelineCursor, addTimelineNoteAt, appendFocusedTimelineTie } from '../src/state/timeline-cursor.ts';
import { createScorePreview, getScorePreviewViewBox, spellPreviewPitch } from '../src/model/score-preview.ts';

function score(count = 4) {
  const project = createProject();
  for (let index = 0; index < count; index++) project.outline.push({
    id: `measure-${index}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }),
  });
  return project;
}

test('preview extracts actual neighboring measures without inventing boundary measures', () => {
  const project = score();
  const before = structuredClone(project);
  const numbers = (preview) => [...preview.xml.matchAll(/<measure number="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(numbers(createScorePreview(project.outline, 0)), [1, 2]);
  assert.equal(createScorePreview(project.outline, 0).activeOffset, 0);
  assert.deepEqual(numbers(createScorePreview(project.outline, 2)), [2, 3, 4]);
  assert.equal(createScorePreview(project.outline, 2).activeOffset, 1);
  assert.deepEqual(numbers(createScorePreview(project.outline, 3)), [3, 4]);
  assert.equal(createScorePreview(project.outline, 3).activeOffset, 1);
  assert.equal(createScorePreview(project.outline, -1), null);
  assert.equal(createScorePreview(project.outline, 4), null);
  assert.equal(createScorePreview(createProject().outline, 0), null);
  assert.deepEqual(project, before);
});

test('the active measure stays geometrically centered regardless of boundary or density', () => {
  for (const [left, width, top, height] of [[0, 120, 0, 160], [350, 240, 40, 170], [940, 600, -10, 200]]) {
    const view = getScorePreviewViewBox(left, width, top, height);
    assert.equal(view.x + view.width / 2, left + width / 2);
    assert.equal(view.y + view.height / 2, top + height / 2);
    assert.ok(view.x < left);
    assert.ok(view.x + view.width > left + width);
    assert.ok(view.y <= top && view.y + view.height >= top + height);
  }
});

test('MusicXML preserves chords, written rests, dots, fingerings and every local voice', () => {
  const project = score(1);
  const measure = project.outline[2];
  measure.data.upperStaff.voices[0].elements = [
    { id: 'chord', kind: 'note', value: { type: 'quarter', dots: 1 }, pitches: [{ midi: 72, fingering: 5 }, { midi: 64 }] },
    { id: 'r1', kind: 'rest', value: { type: 'eighth', dots: 0 } },
    { id: 'r2', kind: 'rest', value: { type: 'half', dots: 0 } },
  ];
  for (const staff of [measure.data.upperStaff, measure.data.lowerStaff]) for (let index = 1; index < 3; index++) {
    staff.voices.push({ id: `voice-${index}`, elements: [{ id: `rest-${staff === measure.data.upperStaff ? 'u' : 'l'}-${index}`, kind: 'measure-rest' }] });
  }
  const xml = createScorePreview(project.outline, 0).xml;
  assert.match(xml, /<divisions>4<\/divisions>/);
  assert.equal([...xml.matchAll(/<backup><duration>16<\/duration><\/backup>/g)].length, 5);
  assert.match(xml, /<chord\/><pitch><step>E<\/step><alter>0<\/alter><octave>4<\/octave><\/pitch><duration>6<\/duration>/);
  assert.match(xml, /<type>quarter<\/type><dot\/>/);
  assert.match(xml, /<fingering>5<\/fingering>/);
  assert.match(xml, /<rest\/><duration>2<\/duration>/);
  assert.match(xml, /<rest\/><duration>8<\/duration>/);
  assert.match(xml, /<voice>6<\/voice>/);
});

test('full-measure rests use actual pickup length, not the nominal time signature', () => {
  const project = score(1);
  project.outline[2].data.length = { cnt: 1, unit: 4 };
  const xml = createScorePreview(project.outline, 0).xml;
  assert.match(xml, /<measure number="1" implicit="yes">/);
  assert.equal([...xml.matchAll(/<rest measure="yes"\/><duration>4<\/duration>/g)].length, 2);
  assert.match(xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/);
});

test('ties within the window are per pitch; connections outside the window are omitted', () => {
  let result = addTimelineNoteAt(score(4), createTimelineCursor(), 15, 60);
  result = appendFocusedTimelineTie(result.project, result.cursor);
  const xml = createScorePreview(result.project.outline, 0).xml;
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
  assert.match(xml, /<tied type="start"\/>/);
  assert.doesNotMatch(createScorePreview(result.project.outline, 2).xml, /<tie /);
});

test('preview spelling follows key-signature notes and keeps their sounding MIDI pitches', () => {
  assert.deepEqual(spellPreviewPitch(70, { fifths: -1 }), { step: 'B', alter: -1, octave: 4, cost: 1 });
  const cb = spellPreviewPitch(59, { fifths: -7 });
  assert.equal(cb.step, 'C');
  assert.equal(cb.alter, -1);
  assert.equal(cb.octave, 4);
  for (const fifths of [-7, -3, 0, 3, 7]) for (let midi = 21; midi <= 108; midi++) {
    const pitch = spellPreviewPitch(midi, { fifths });
    const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.step];
    assert.equal((pitch.octave + 1) * 12 + natural + pitch.alter, midi);
  }
});
