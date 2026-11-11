import assert from 'node:assert/strict';
import { test } from 'node:test';
import TimelineView from '../src/state/timeline-view.ts';
import { createMeasureData } from '../src/model/project.ts';
const fit = (pitches, current = 0, height = 120) => TimelineView.bestPitchScrollTop(pitches, current, height, 2100, 60, 24);
const count = (pitches, top, height) => pitches.filter(p => { const y = 60 + (108-p)*24; return y >= top+12 && y+24 <= top+height-12; }).length;

test('fits the densest cluster including repeated pitches, preserving an already optimal view', () => {
  const pitches = [108, 60, 60, 61, 62, 21];
  const top = fit(pitches);
  assert.equal(count(pitches, top, 120), 4);
  assert.equal(fit(pitches, top), top);
  assert.equal(fit([], 700), 700);
});

test('equally dense regions choose the closest one and respect scroll limits', () => {
  const pitches = [108, 107, 40, 39];
  assert.ok(fit(pitches, 0) < 100);
  assert.ok(fit(pitches, 1800) > 1500);
  assert.equal(fit([108], 900), 48);
  assert.ok(fit([21], 0) <= 2100);
});

test('matches exhaustive counts and minimum movement across different distributions', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const pitches = Array.from({ length: 25 }, (_, i) => 21 + ((i*i + seed*13 + i*seed) % 88));
    const current = seed*63, height = 96 + (seed%5)*24;
    const top = fit(pitches, current, height);
    let bestCount = -1, distance = Infinity;
    for (let y = 0; y <= 2100; y++) {
      const n = count(pitches, y, height);
      if (n > bestCount) { bestCount = n; distance = Math.abs(y-current); }
      else if (n === bestCount) distance = Math.min(distance, Math.abs(y-current));
    }
    assert.equal(count(pitches, top, height), bestCount);
    assert.equal(Math.abs(top-current), distance);
  }
});

test('collects chords, repeated attacks, graces and every staff/voice while excluding rests', () => {
  const data = createMeasureData({ cnt: 4, unit: 4 });
  const note = (id, pitches) => ({ id, kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: pitches.map(midi => ({ midi })) });
  const a = note('a', [60, 64]);
  a.beforeGraceNotes = [{ id: 'g', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 59 }] }];
  data.upperStaff.voices[0].elements = [a, note('b', [60]), { id: 'rest', kind: 'rest', value: { type: 'half', dots: 0 } }];
  data.upperStaff.voices.push({ id: 'v2', elements: [note('c', [72])] });
  data.lowerStaff.voices[0].elements = [note('d', [48])];
  assert.deepEqual(TimelineView.measurePitches({ type: 'measure', id: 'm', data }).sort((a,b) => a-b), [48,59,60,60,64,72]);
});
