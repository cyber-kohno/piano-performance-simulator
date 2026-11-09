import test from 'node:test';
import assert from 'node:assert/strict';
import FloatingText from '../src/state/floating-text-input.ts';

const key = (key, extra = {}) => ({ key, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

test('edits characters at its own cursor without replacing the initial value', () => {
  let state = FloatingText.create('Part1');
  for (const input of ['ArrowLeft', 'Backspace', '-', '2', 'Delete']) {
    state = FloatingText.control(state, key(input), 32).state;
  }
  assert.deepEqual(state, { value: 'Par-2', cursor: 5 });
  assert.equal(FloatingText.control(state, key('Enter'), 32).action, 'commit');
  assert.equal(FloatingText.control(state, key('Escape'), 32).action, 'cancel');
});

test('matches Scorehack ASCII input and ignores IME and command shortcuts', () => {
  const state = FloatingText.create('');
  for (const input of [key('あ'), key('é'), key('Dead'), key('a', { isComposing: true }),
    key('a', { ctrlKey: true }), key('v', { metaKey: true }), key('a', { altKey: true })]) {
    assert.equal(FloatingText.control(state, input, 32).state, state);
  }
  for (const char of "aZ09 _'.,#-") {
    assert.equal(FloatingText.control(state, key(char), 32).state.value, char);
  }
});

test('bounds the cursor and length while allowing deletion at the limit', () => {
  let state = FloatingText.create('1-2');
  assert.equal(FloatingText.control(state, key('3'), 3).state, state);
  state = FloatingText.control(state, key('Backspace'), 3).state;
  assert.deepEqual(FloatingText.control(state, key('5'), 3).state, { value: '1-5', cursor: 3 });
  assert.equal(FloatingText.control({ value: '', cursor: 0 }, key('ArrowLeft'), 3).state.cursor, 0);
  assert.equal(FloatingText.control(state, key('ArrowRight'), 3).state.cursor, state.value.length);
});
