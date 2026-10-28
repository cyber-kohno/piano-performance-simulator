import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, rational, fromNumber, compare, toNumber, addTime } from '../src/model/rational.ts';
import { createProject, createMeasureData, getElementTime, getLocatedVoiceElements, getFlattenedVoiceElements, reconcileOutlineTies } from '../src/model/project.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
import {
  createTimelineCursor, toggleTimelineTuplet, setTimelineCursorUnit, toggleTimelineCursorDot,
  addTimelineNoteAt, getLocatedTimelineNotes, getLocatedTimelineNote, moveTimelineCursorHorizontally,
  isTimelinePlacementInvalid, findTimelineNoteAtMove, deleteFocusedTimelineNote, addFocusedNotePitch,
  moveFocusedTimelineNotePitch, setFocusedTimelineNoteType, moveFocusedTimelineNote, resizeFocusedTimelineTie,
  appendFocusedTimelineTie, switchTimelineStaff, addNextTimelineVoice, cycleTimelineVoice,
  extendTimelineNoteSelection, transposeSelectedTimelineNotes,
} from '../src/state/timeline-cursor.ts';
import { changeOutlineMeasureBeats } from '../src/state/outline-cursor.ts';

function score(count = 2) {
  const project = createProject();
  for (let index = 0; index < count; index++) project.outline.push({ id: `m${index}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
const input = (key = '1') => toggleTimelineTuplet(setTimelineCursorUnit(createTimelineCursor(), key));
function assertComplete(project) {
  const ids = new Set();
  for (const block of project.outline) if (block.type === 'measure') for (const staff of [block.data.upperStaff, block.data.lowerStaff]) for (const voice of staff.voices) {
    const total = voice.elements.reduce((sum, element) => add(sum, getElementTime(element, block.data.length)), rational(0));
    assert.equal(compare(total, rational(block.data.length.cnt * 16, block.data.length.unit)), 0);
    for (const { element } of getFlattenedVoiceElements(voice, block.data.length)) {
      assert.equal(ids.has(element.id), false); ids.add(element.id);
      assert.equal('positionSixteenths' in element, false);
      assert.equal('duration' in element, false);
    }
  }
}

test('fraction time has no cumulative triplet drift and supports future quintuplets', () => {
  let time = rational(0);
  for (let i = 0; i < 1500; i++) time = add(time, rational(2, 3));
  assert.deepEqual(time, rational(1000));
  assert.deepEqual(fromNumber(100 / 3), rational(100, 3));
  assert.equal(addTime(100 / 3, 2 / 3), 34);
  assert.deepEqual(add(rational(1, 3), rational(1, 5)), rational(8, 15));
});

test('slash toggles 16th, eighth and quarter triplets without moving or changing saved notes', () => {
  for (const key of ['1', '2', '3']) {
    const cursor = { ...setTimelineCursorUnit(createTimelineCursor(), key), positionSixteenths: 0.5, focusedNoteId: 'keep' };
    const triplet = toggleTimelineTuplet(cursor);
    assert.deepEqual(triplet.tuplet, { actual: 3, normal: 2 });
    assert.equal(triplet.positionSixteenths, 0.5);
    assert.equal(triplet.focusedNoteId, 'keep');
    assert.equal(toggleTimelineTuplet(triplet).tuplet, null);
    assert.deepEqual(toggleTimelineCursorDot(triplet), triplet);
  }
  const smallest = setTimelineCursorUnit(input(), '4');
  assert.equal(smallest.tuplet, null);
  assert.equal(toggleTimelineTuplet(smallest), smallest);
});

test('changing the input note type clears triplets without moving or changing selection', () => {
  for (const source of ['1', '2', '3']) for (const destination of ['1', '2', '3', '4']) {
    if (source === destination) continue;
    const cursor = { ...input(source), positionSixteenths: 2 / 3, focusedNoteId: 'selected', focusedPitchIndex: 0 };
    const next = setTimelineCursorUnit(cursor, destination);
    assert.equal(next.tuplet, null);
    assert.equal(next.positionSixteenths, cursor.positionSixteenths);
    assert.equal(next.focusedNoteId, cursor.focusedNoteId);
    assert.equal(next.focusedPitchIndex, cursor.focusedPitchIndex);
  }
});

test('first insertion creates a complete rest-filled group and subsequent notes replace just its rests', () => {
  for (const [key, groupLength] of [['1', 2], ['2', 4], ['3', 8]]) {
    let state = addTimelineNoteAt(score(), input(key), 0, 60);
    const group = state.project.outline[2].data.upperStaff.voices[0].elements[0];
    assert.equal(group.kind, 'tuplet');
    assert.equal(group.elements.filter((element) => element.kind === 'rest').length, 2);
    const firstId = state.cursor.focusedNoteId;
    for (let index = 1; index < 3; index++) state = addTimelineNoteAt(state.project, state.cursor, toNumber(rational(groupLength * index, 3)), 60 + index);
    const notes = getLocatedTimelineNotes(state.project.outline);
    assert.equal(notes.length, 3);
    assert.equal(notes[0].note.id, firstId);
    assert.equal(getLocatedVoiceElements(state.project.outline[2].data.upperStaff.voices[0], { cnt: 4, unit: 4 })[1].positionSixteenths, groupLength);
    assertComplete(state.project);
  }
});

test('triplet navigation lands exactly on beats, barlines and note boundaries in either direction', () => {
  const project = score(50);
  let cursor = input();
  for (let i = 0; i < 240; i++) cursor = moveTimelineCursorHorizontally(cursor, project.outline, 1);
  assert.equal(cursor.positionSixteenths, 160);
  for (let i = 0; i < 240; i++) cursor = moveTimelineCursorHorizontally(cursor, project.outline, -1);
  assert.equal(cursor.positionSixteenths, 0);
  let state = addTimelineNoteAt(project, input(), 16, 60);
  state = addTimelineNoteAt(state.project, state.cursor, 16 + 2 / 3, 62);
  const clear = { ...state.cursor, positionSixteenths: 16 + 4 / 3, focusedNoteId: null, focusedPitchIndex: null };
  assert.equal(findTimelineNoteAtMove(state.project.outline, clear, 1), undefined);
  assert.equal(findTimelineNoteAtMove(state.project.outline, clear, -1).note.id, state.cursor.focusedNoteId);
});

test('group insertion rejects occupied spans, bar overflow and grid-incompatible starts atomically', () => {
  const plain = addTimelineNoteAt(score(), createTimelineCursor(), 1, 60);
  assert.equal(addTimelineNoteAt(plain.project, input(), 0, 62), undefined);
  assert.equal(addTimelineNoteAt(score(), input('2'), 14, 62), undefined);
  assert.equal(addTimelineNoteAt(score(), input(), 1 / 3, 62), undefined);
  const state = addTimelineNoteAt(score(), input(), 0, 60);
  const before = structuredClone(state.project);
  assert.equal(addTimelineNoteAt(state.project, input('2'), 2 / 3, 62), undefined);
  assert.equal(addTimelineNoteAt(state.project, createTimelineCursor(), 0, 62), undefined);
  assert.deepEqual(state.project, before);
  assert.equal(isTimelinePlacementInvalid(state.project.outline, { ...input(), positionSixteenths: 0 }), true);
});

test('grouped chord, pitch and delete edits preserve the group and recover its original rest slot', () => {
  let state = addTimelineNoteAt(score(), input(), 0, 60);
  state = addFocusedNotePitch(state.project, state.cursor);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, -1);
  const groupId = state.project.outline[2].data.upperStaff.voices[0].elements[0].id;
  state = deleteFocusedTimelineNote(state.project, state.cursor);
  assert.equal(state.project.outline[2].data.upperStaff.voices[0].elements[0].id, groupId);
  assert.equal(getLocatedTimelineNotes(state.project.outline).length, 0);
  const replaced = addTimelineNoteAt(state.project, state.cursor, 0, 65);
  assert.ok(replaced);
  assertComplete(replaced.project);
});

test('cross-voice collision uses true tuplet spans and permits exactly touching endpoints', () => {
  const upper = addTimelineNoteAt(score(), input(), 0, 60);
  const lowerInput = { ...input(), staff: 'lowerStaff' };
  assert.equal(addTimelineNoteAt(upper.project, lowerInput, 0, 60), undefined);
  const lower = addTimelineNoteAt(upper.project, lowerInput, 0, 62);
  assert.equal(addTimelineNoteAt(lower.project, lowerInput, 2 / 3, 60) !== undefined, true);
  assertComplete(lower.project);
});

test('grouped ties use performed time, survive reconciliation and preserve chord edits', () => {
  const first = addTimelineNoteAt(score(), input(), 0, 60);
  const second = appendFocusedTimelineTie(first.project, first.cursor);
  assert.ok(second);
  const next = reconcileOutlineTies(second.project.outline);
  assert.equal(getLocatedTimelineNote(next, second.cursor.focusedNoteId).note.tieFrom, first.cursor.focusedNoteId);
  const edited = addFocusedNotePitch({ ...second.project, outline: next }, second.cursor);
  assert.equal(getLocatedTimelineNote(edited.project.outline, first.cursor.focusedNoteId).note.pitches.length, 2);
  assertComplete(edited.project);
});

test('unsupported duration, move and normalization edits never flatten or truncate groups', () => {
  const state = addTimelineNoteAt(score(), input(), 14, 60);
  const before = structuredClone(state.project);
  assert.equal(setFocusedTimelineNoteType(state.project, state.cursor, '2'), undefined);
  assert.equal(moveFocusedTimelineNote(state.project, state.cursor, 1), undefined);
  assert.equal(resizeFocusedTimelineTie(state.project, state.cursor, 1), undefined);
  assert.equal(changeOutlineMeasureBeats(state.project.outline, { blockId: 'm0' }, -1), state.project.outline);
  assert.deepEqual(state.project, before);
});

test('staff and voice switching retain triplet input while maintaining local voice rules', () => {
  let project = score();
  const cursor = input();
  project = addNextTimelineVoice(project, cursor);
  assert.deepEqual(cycleTimelineVoice(project.outline, cursor).tuplet, cursor.tuplet);
  assert.deepEqual(switchTimelineStaff(project.outline, cursor).tuplet, cursor.tuplet);
  const state = addTimelineNoteAt(project, { ...cursor, voiceIndex: 1 }, 0, 60);
  assert.ok(state);
  assert.equal(state.project.outline[2].data.upperStaff.voices[0].elements[0].kind, 'measure-rest');
  assertComplete(state.project);
});

test('MusicXML exports integer durations, time modifications and one bracket per group', () => {
  const state = addTimelineNoteAt(score(), input(), 0, 60);
  const xml = createScorePreview(state.project.outline, 0).xml;
  assert.match(xml, /<divisions>24<\/divisions>/);
  assert.equal([...xml.matchAll(/<actual-notes>3<\/actual-notes><normal-notes>2<\/normal-notes>/g)].length, 3);
  assert.match(xml, /<normal-type>16th<\/normal-type>/);
  assert.match(xml, /<tuplet type="start" bracket="yes"\/>/);
  assert.match(xml, /<tuplet type="stop"\/>/);
  assert.equal([...xml.matchAll(/<duration>([^<]+)<\/duration>/g)].every((match) => Number.isInteger(Number(match[1]))), true);
});

test('future quintuplets and mixed written values use ratios rather than fixed child counts', () => {
  const group = { id: 'five', kind: 'tuplet', actual: 5, normal: 4, baseType: 'eighth', elements: Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, kind: 'rest', value: { type: 'eighth', dots: 0 } })) };
  assert.deepEqual(getElementTime(group, { cnt: 4, unit: 4 }), rational(8));
  const mixed = { id: 'mixed', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth', elements: [
    { id: 'quarter', kind: 'rest', value: { type: 'quarter', dots: 0 } },
    { id: 'eighth', kind: 'rest', value: { type: 'eighth', dots: 0 } },
  ] };
  assert.deepEqual(getElementTime(mixed, { cnt: 4, unit: 4 }), rational(4));
  assert.throws(() => getElementTime({ ...mixed, elements: [] }, { cnt: 4, unit: 4 }), /Incomplete/);
});

test('ordinary edits cannot consume even an all-rest tuplet, but can jump past one intact', () => {
  let state = addTimelineNoteAt(score(), input(), 2, 64);
  state = deleteFocusedTimelineNote(state.project, state.cursor);
  const plain = addTimelineNoteAt(state.project, createTimelineCursor(), 0, 60);
  const group = structuredClone(plain.project.outline[2].data.upperStaff.voices[0].elements.find((element) => element.kind === 'tuplet'));
  assert.equal(setFocusedTimelineNoteType(plain.project, plain.cursor, '3'), undefined);
  assert.equal(moveFocusedTimelineNote(plain.project, { ...plain.cursor, placementValue: { type: 'quarter', dots: 0 } }, 1) !== undefined, true);
  assert.deepEqual(plain.project.outline[2].data.upperStaff.voices[0].elements.find((element) => element.kind === 'tuplet'), group);
});

test('range transposition and deletion recurse through groups without changing their time', () => {
  const first = addTimelineNoteAt(score(), input(), 0, 60);
  const second = addTimelineNoteAt(first.project, first.cursor, 2 / 3, 64);
  const cursor = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
  const moved = transposeSelectedTimelineNotes(second.project, cursor, 1);
  assert.deepEqual(getLocatedTimelineNotes(moved.project.outline).map(({ note }) => note.pitches[0].midi), [61, 65]);
  const removed = deleteFocusedTimelineNote(moved.project, moved.cursor);
  assert.equal(getLocatedTimelineNotes(removed.project.outline).length, 0);
  assert.equal(removed.project.outline[2].data.upperStaff.voices[0].elements[0].kind, 'tuplet');
  assertComplete(removed.project);
});

test('tied tuplet input can continue into a new group and an existing next bar', () => {
  let state = addTimelineNoteAt(score(), input(), 14, 60);
  const firstId = state.cursor.focusedNoteId;
  for (let index = 0; index < 3; index++) state = appendFocusedTimelineTie(state.project, state.cursor);
  assert.equal(state.cursor.positionSixteenths, 16);
  const outline = reconcileOutlineTies(state.project.outline);
  assert.equal(getLocatedTimelineNote(outline, firstId).note.tieTo !== undefined, true);
  assert.equal(getLocatedTimelineNote(outline, state.cursor.focusedNoteId).note.tieFrom !== undefined, true);
  assertComplete(state.project);
});
