import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTimelineNumberInput, resolveTimelineDotInput } from '../src/state/number-input.ts';

test('dot targets the selected note, while Shift+Period targets cursor despite its > character', () => {
  const dot = { key: '.', code: 'Period', shiftKey: false };
  assert.equal(resolveTimelineDotInput(dot, true), 'note');
  assert.equal(resolveTimelineDotInput(dot, false), 'cursor');
  assert.equal(resolveTimelineDotInput(dot, true, true), 'cursor');
  assert.equal(resolveTimelineDotInput({ key: '>', code: 'Period', shiftKey: true }, true), 'cursor');
  assert.equal(resolveTimelineDotInput({ key: '.', code: 'NumpadDecimal', shiftKey: false }, true), 'note');
  assert.equal(resolveTimelineDotInput({ key: 'Delete', code: 'NumpadDecimal', shiftKey: false }, true), undefined);
  assert.equal(resolveTimelineDotInput({ key: '>', code: '', shiftKey: false }, true), undefined);
});

test('plain digits edit a focused note and otherwise change the input value', () => {
  for (const key of ['1', '2', '3', '4']) {
    const event = { key, code: `Digit${key}`, shiftKey: false };
    assert.deepEqual(resolveTimelineNumberInput(event, true), { key, target: 'note' });
    assert.deepEqual(resolveTimelineNumberInput(event, false), { key, target: 'cursor' });
  }
});

test('Shift digits change input despite shifted keyboard characters or held-key state', () => {
  for (const [key, symbols] of [['1', ['!']], ['2', ['@', '"']], ['3', ['#']], ['4', ['$']]]) {
    for (const symbol of symbols) {
      assert.deepEqual(resolveTimelineNumberInput({ key: symbol, code: `Digit${key}`, shiftKey: true }, true),
        { key, target: 'cursor' });
    }
    assert.deepEqual(resolveTimelineNumberInput({ key, code: `Digit${key}`, shiftKey: false }, true, true),
      { key, target: 'cursor' });
  }
});

test('numpad digits are supported and unrelated keys are ignored', () => {
  assert.deepEqual(resolveTimelineNumberInput({ key: '2', code: 'Numpad2', shiftKey: false }, true),
    { key: '2', target: 'note' });
  for (const key of ['5', '.', 'a', 'ArrowLeft']) {
    assert.equal(resolveTimelineNumberInput({ key, code: '', shiftKey: false }, true), undefined);
  }
});
