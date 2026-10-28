import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMeasureBeatDisplay } from '../src/state/measure-beats.ts';

test('standard bars show perceived beat counts, with 3/8 remaining simple triple meter', () => {
  for (const [cnt, unit, beats] of [[2, 4, 2], [3, 4, 3], [4, 4, 4], [3, 8, 3], [6, 8, 2], [9, 8, 3], [12, 8, 4]]) {
    const result = getMeasureBeatDisplay({ cnt, unit }, { cnt, unit });
    assert.equal(result.actualBeats, beats);
    assert.equal(result.standardBeats, beats);
    assert.equal(result.actualLabel, String(beats));
    assert.deepEqual(result.chips, Array(beats).fill(1));
  }
});

test('short bars retain the standard chip count and fill only their actual beats', () => {
  const shortSimple = getMeasureBeatDisplay({ cnt: 3, unit: 4 }, { cnt: 2, unit: 4 });
  assert.equal(shortSimple.actualLabel, '2');
  assert.equal(shortSimple.standardBeats, 3);
  assert.deepEqual(shortSimple.chips, [1, 1, 0]);
  const pickup = getMeasureBeatDisplay({ cnt: 4, unit: 4 }, { cnt: 1, unit: 4 });
  assert.deepEqual(pickup.chips, [1, 0, 0, 0]);
  const compound = getMeasureBeatDisplay({ cnt: 6, unit: 8 }, { cnt: 3, unit: 8 });
  assert.equal(compound.actualBeats, 1);
  assert.equal(compound.standardBeats, 2);
  assert.deepEqual(compound.chips, [1, 0]);
});

test('partial beats use exact reduced labels and proportional chip fill', () => {
  const third = getMeasureBeatDisplay({ cnt: 6, unit: 8 }, { cnt: 1, unit: 8 });
  assert.equal(third.actualLabel, '(1/3)');
  assert.deepEqual(third.chips, [1 / 3, 0]);
  const fiveEighths = getMeasureBeatDisplay({ cnt: 6, unit: 8 }, { cnt: 5, unit: 8 });
  assert.equal(fiveEighths.actualLabel, '(5/3)');
  assert.equal(fiveEighths.standardBeats, 2);
  assert.equal(fiveEighths.chips[0], 1);
  assert.ok(Math.abs(fiveEighths.chips[1] - 2 / 3) < 1e-8);
  const half = getMeasureBeatDisplay({ cnt: 3, unit: 8 }, { cnt: 1, unit: 16 });
  assert.equal(half.actualLabel, '(1/2)');
  assert.deepEqual(half.chips, [0.5, 0, 0]);
});

test('display derives from saved lengths without changing them or hiding existing extra beats', () => {
  const meter = Object.freeze({ cnt: 4, unit: 4 });
  const length = Object.freeze({ cnt: 5, unit: 4 });
  const result = getMeasureBeatDisplay(meter, length);
  assert.equal(result.actualBeats, 5);
  assert.equal(result.standardBeats, 4);
  assert.deepEqual(result.chips, [1, 1, 1, 1, 1]);
  assert.deepEqual(length, { cnt: 5, unit: 4 });
  assert.deepEqual(meter, { cnt: 4, unit: 4 });
});
