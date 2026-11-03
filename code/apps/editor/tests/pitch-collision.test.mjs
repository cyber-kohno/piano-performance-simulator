import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject, createMeasureData, createRestElements, getNoteValueSixteenths } from '../src/model/project.ts';
import { hasCrossVoicePitchCollision } from '../src/model/pitch-collision.ts';
import {
  createTimelineCursor, setTimelineCursorUnit, addTimelineNoteAt, isTimelinePlacementInvalid,
  appendFocusedTimelineTie, duplicateFocusedTimelineNoteAfter, moveFocusedTimelineNote,
  setFocusedTimelineNoteValue, toggleFocusedTimelineNoteDot, resizeFocusedTimelineTie,
  moveFocusedTimelineNotePitch, addFocusedNotePitch, extendTimelineNoteSelection,
  transposeSelectedTimelineNotes, getLocatedTimelineNote,
} from '../src/state/timeline-cursor.ts';

function blank(count = 1) {
  const project = createProject();
  for (let i = 0; i < count; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
function input(staff, unit = '1') { return setTimelineCursorUnit(createTimelineCursor(staff), unit); }
function source(staff, unit = '1', position = 0, count = 1) {
  return addTimelineNoteAt(blank(count), input(staff, unit), position, 60);
}
function noteOf(state) { return getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId, state.cursor.staff).note; }

// Populate another voice directly so fixtures can also cover legacy conflicting data.
function otherNotes(project, staff, voiceIndex, notes) {
  let start = 0;
  for (const block of project.outline) {
    if (block.type !== 'measure') continue;
    const length = block.data.length.cnt / block.data.length.unit * 16;
    const local = notes.filter(note => note.at >= start && note.at < start + length).sort((a, b) => a.at - b.at);
    const elements = [];
    let position = 0;
    for (const [index, note] of local.entries()) {
      const at = note.at - start;
      elements.push(...createRestElements(position, at - position), {
        id: `external-${staff}-${voiceIndex}-${block.id}-${index}`, kind: 'note',
        value: note.value ?? { type: '16th', dots: 0 },
        pitches: note.midis.map(midi => ({ midi })).sort((a, b) => b.midi - a.midi),
      });
      position = at + getNoteValueSixteenths(elements[elements.length - 1].value);
    }
    elements.push(...createRestElements(position, length - position));
    block.data[staff].voices[voiceIndex] = { id: `voice-${voiceIndex}`, elements };
    start += length;
  }
}
function rejected(state, action) {
  const before = structuredClone(state);
  assert.equal(action(), undefined);
  assert.deepEqual(state, before, 'rejection must preserve both project and cursor');
}

for (const staff of ['upperStaff', 'lowerStaff']) {
  const opposite = staff === 'upperStaff' ? 'lowerStaff' : 'upperStaff';
  for (const [scope, otherStaff, voiceIndex] of [
    ['other staff, voice 0', opposite, 0],
    ['same staff, voice 1', staff, 1],
    ['other staff, voice 1', opposite, 1],
  ]) {
    const name = `${staff} vs ${scope}`;

    test(`${name}: placement blocks shared pitches, permits distinct pitches and touching endpoints`, () => {
      const project = blank();
      otherNotes(project, otherStaff, voiceIndex, [{ at: 0, value: { type: 'quarter', dots: 0 }, midis: [64, 60] }]);
      const cursor = { ...input(staff, '3'), pitch: 60 };
      const before = structuredClone(project);
      assert.equal(addTimelineNoteAt(project, cursor), undefined);
      assert.equal(isTimelinePlacementInvalid(project.outline, cursor), true);
      assert.ok(addTimelineNoteAt(project, cursor, 0, 61));
      assert.equal(isTimelinePlacementInvalid(project.outline, { ...cursor, pitch: 61 }), false);
      assert.ok(addTimelineNoteAt(project, cursor, 4, 60));
      assert.deepEqual(project, before);
    });

    test(`${name}: horizontal movement blocks same pitches but allows other pitches and jumping past notes`, () => {
      const state = source(staff, '3');
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 4, midis: [60] }]);
      rejected(state, () => moveFocusedTimelineNote(state.project, setTimelineCursorUnit(state.cursor, '1'), 1));
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 1, midis: [61] }]);
      assert.ok(moveFocusedTimelineNote(state.project, setTimelineCursorUnit(state.cursor, '1'), 1));
      const jumping = source(staff);
      otherNotes(jumping.project, otherStaff, voiceIndex, [{ at: 2, midis: [60] }]);
      assert.ok(moveFocusedTimelineNote(jumping.project, setTimelineCursorUnit(jumping.cursor, '3'), 1));
    });

    test(`${name}: explicit value edits, dots and automatic extension block same-pitch overlap`, () => {
      const state = source(staff);
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 1, midis: [60] }]);
      rejected(state, () => setFocusedTimelineNoteValue(state.project, state.cursor, { type: 'quarter', dots: 0 }));
      rejected(state, () => resizeFocusedTimelineTie(state.project, state.cursor, 1));
      const eighth = source(staff, '2');
      otherNotes(eighth.project, otherStaff, voiceIndex, [{ at: 2, midis: [60] }]);
      rejected(eighth, () => toggleFocusedTimelineNoteDot(eighth.project, eighth.cursor));
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 1, midis: [61] }]);
      assert.ok(resizeFocusedTimelineTie(state.project, state.cursor, 1));
    });

    test(`${name}: relocated tied successors and cross-bar extension are checked atomically`, () => {
      const first = source(staff, '3');
      const chain = appendFocusedTimelineTie(first.project, first.cursor);
      otherNotes(chain.project, otherStaff, voiceIndex, [{ at: 8, midis: [60] }]);
      rejected(chain, () => setFocusedTimelineNoteValue(chain.project, first.cursor, { type: 'half', dots: 0 }));
      const tail = source(staff, '3', 12, 2);
      otherNotes(tail.project, otherStaff, voiceIndex, [{ at: 16, midis: [60] }]);
      rejected(tail, () => resizeFocusedTimelineTie(tail.project, setTimelineCursorUnit(tail.cursor, '1'), 1));
      rejected(tail, () => appendFocusedTimelineTie(tail.project, tail.cursor));
      rejected(tail, () => duplicateFocusedTimelineNoteAfter(tail.project, tail.cursor));
    });

    test(`${name}: adjacent chord copies check every pitch, not only the selected pitch`, () => {
      const state = source(staff);
      noteOf(state).pitches.unshift({ midi: 64, fingering: 4 });
      state.cursor = { ...state.cursor, focusedPitchIndex: 1 };
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 1, midis: [64] }]);
      rejected(state, () => appendFocusedTimelineTie(state.project, state.cursor));
      rejected(state, () => duplicateFocusedTimelineNoteAfter(state.project, state.cursor));
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 1, midis: [65] }]);
      assert.ok(appendFocusedTimelineTie(state.project, state.cursor));
      assert.ok(duplicateFocusedTimelineNoteAfter(state.project, state.cursor));
    });

    test(`${name}: pitch edits and E+A block collisions and do not skip the conflicting other voice`, () => {
      const state = source(staff, '3');
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 0, midis: [61, 59] }]);
      rejected(state, () => moveFocusedTimelineNotePitch(state.project, state.cursor, 1));
      rejected(state, () => addFocusedNotePitch(state.project, state.cursor));
      otherNotes(state.project, otherStaff, voiceIndex, [{ at: 0, midis: [62] }]);
      rejected(state, () => moveFocusedTimelineNotePitch(state.project, state.cursor, 1, { fifths: 0 }));
      assert.ok(moveFocusedTimelineNotePitch(state.project, state.cursor, -1));
      const chain = appendFocusedTimelineTie(state.project, state.cursor);
      otherNotes(chain.project, otherStaff, voiceIndex, [{ at: 4, midis: [61, 59] }]);
      rejected(chain, () => moveFocusedTimelineNotePitch(chain.project, state.cursor, 1));
      rejected(chain, () => addFocusedNotePitch(chain.project, state.cursor));
    });

    test(`${name}: one colliding range member rejects the entire move or transposition`, () => {
      const first = source(staff);
      const second = addTimelineNoteAt(first.project, first.cursor, 4, 64);
      const cursor = extendTimelineNoteSelection(second.project.outline, first.cursor, 1);
      otherNotes(second.project, otherStaff, voiceIndex, [{ at: 4, midis: [65] }, { at: 5, midis: [64] }]);
      rejected(second, () => transposeSelectedTimelineNotes(second.project, cursor, 1));
      rejected(second, () => moveFocusedTimelineNote(second.project, cursor, 1));
      assert.ok(transposeSelectedTimelineNotes(second.project, cursor, -1));
    });
  }
}

test('unrelated legacy collisions do not prevent editing a different note', () => {
  const first = source('upperStaff');
  otherNotes(first.project, 'lowerStaff', 0, [{ at: 0, midis: [60] }]);
  const second = addTimelineNoteAt(first.project, first.cursor, 8, 64);
  assert.ok(second);
  assert.ok(moveFocusedTimelineNotePitch(second.project, second.cursor, 1));
});

test('the shared validator excludes only the same staff and voice ID, not matching voice IDs on another staff', () => {
  const state = source('upperStaff');
  const span = { staff: 'upperStaff', voiceId: 'voice-0', startSixteenths: 0, lengthSixteenths: 1, pitches: [{ midi: 60 }] };
  assert.equal(hasCrossVoicePitchCollision(state.project.outline, [span]), false);
  assert.equal(hasCrossVoicePitchCollision(state.project.outline, [{ ...span, staff: 'lowerStaff' }]), true);
  assert.equal(hasCrossVoicePitchCollision(state.project.outline, [{ ...span, voiceId: 'voice-1' }]), true);
  assert.equal(hasCrossVoicePitchCollision(state.project.outline, [{ ...span, staff: 'lowerStaff', startSixteenths: 1 }]), false);
});
