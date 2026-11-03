import assert from 'node:assert/strict';
import { test } from 'node:test';
import { add, rational, compare } from '../src/model/rational.ts';
import { createProject, createMeasureData, createRestElements, getElementTime, getFlattenedVoiceElements, getLocatedVoiceElements, reconcileOutlineTies } from '../src/model/project.ts';
import { createScorePreview } from '../src/model/score-preview.ts';
import { getTupletContext } from '../src/state/tuplet-input.ts';
import {
  createTimelineCursor, convertFocusedTimelineTuplet, setTimelineCursorUnit, toggleTimelineCursorDot,
  addTimelineNoteAt, getLocatedTimelineNotes, getLocatedTimelineNote, moveTimelineCursorHorizontally,
  getTimelineInputSixteenths, getTimelineInputValue, getTimelineFixedInputContext, isTimelinePlacementInvalid, findTimelineNoteAtMove,
  deleteFocusedTimelineNote, addFocusedNotePitch, moveFocusedTimelineNotePitch, setFocusedTimelineNoteType,
  toggleFocusedTimelineNoteDot, moveFocusedTimelineNote, resizeFocusedTimelineNote, resizeFocusedTimelineTie,
  appendFocusedTimelineTie, switchTimelineStaff, addNextTimelineVoice, cycleTimelineVoice,
  toggleTieToAdjacentTimelineNote,
  extendTimelineNoteSelection, transposeSelectedTimelineNotes,
} from '../src/state/timeline-cursor.ts';
import { changeOutlineMeasureBeats } from '../src/state/outline-cursor.ts';

function score(count = 3) {
  const project = createProject();
  for (let index = 0; index < count; index++) project.outline.push({ id: 'm' + index, type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  return project;
}
function group(base = 'eighth', position = 0, project = score(), extra = {}) {
  const parent = { quarter: 'half', eighth: 'quarter', '16th': 'eighth' }[base];
  const cursor = { ...createTimelineCursor(), ...extra, placementValue: { type: parent, dots: 0 } };
  const placed = addTimelineNoteAt(project, cursor, position, 60);
  return convertFocusedTimelineTuplet(placed.project, placed.cursor);
}
const notes = (state) => getLocatedTimelineNotes(state.project.outline, state.cursor.staff, state.cursor.voiceIndex);
const clear = (cursor, position) => ({ ...cursor, positionSixteenths: position, focusedNoteId: null, focusedPitchIndex: null, selectionAnchorNoteId: null });
function select(state, first, last) {
  const all = notes(state);
  return { ...state.cursor, focusedNoteId: all[last].note.id, selectionAnchorNoteId: all[first].note.id,
    focusedPitchIndex: null, positionSixteenths: all[last].measureStartSixteenths + all[last].positionSixteenths };
}
function complete(project) {
  const ids = new Set();
  for (const block of project.outline) if (block.type === 'measure') for (const staff of [block.data.upperStaff, block.data.lowerStaff]) for (const voice of staff.voices) {
    const total = voice.elements.reduce((sum, element) => add(sum, getElementTime(element, block.data.length)), rational(0));
    assert.equal(compare(total, rational(block.data.length.cnt * 16, block.data.length.unit)), 0);
    for (const { element } of getFlattenedVoiceElements(voice, block.data.length)) {
      assert.equal(ids.has(element.id), false); ids.add(element.id);
      assert.equal('positionSixteenths' in element, false);
    }
  }
}

test('slash divides the existing note time into three, preserving identity, pitches and surrounding notes', () => {
  for (const [parent, base, span] of [['half', 'quarter', 8], ['quarter', 'eighth', 4], ['eighth', '16th', 2]]) {
    const placed = addTimelineNoteAt(score(), { ...createTimelineCursor(), placementValue: { type: parent, dots: 0 } }, 0, 60);
    const chord = addFocusedNotePitch(placed.project, placed.cursor);
    const following = addTimelineNoteAt(chord.project, createTimelineCursor(), span, 67);
    const result = convertFocusedTimelineTuplet(following.project, chord.cursor);
    assert.ok(result);
    const context = getTupletContext(result.project.outline, result.cursor);
    assert.equal(context.group.baseType, base);
    assert.equal(context.end, span);
    assert.equal(context.group.elements.filter((element) => element.kind === 'rest').length, 2);
    assert.equal(notes(result)[0].note.id, chord.cursor.focusedNoteId);
    assert.equal(notes(result)[0].note.pitches.length, 2);
    assert.equal(notes(result)[0].lengthSixteenths, span / 3);
    assert.equal(getLocatedTimelineNote(result.project.outline, following.cursor.focusedNoteId).positionSixteenths, span);
    complete(result.project);
  }
});

test('slash refuses empty cursor, existing groups, dots, unsupported source types, ties and ranges', () => {
  assert.equal(convertFocusedTimelineTuplet(score(), createTimelineCursor()), undefined);
  const existing = group();
  assert.equal(convertFocusedTimelineTuplet(existing.project, existing.cursor), undefined);
  for (const value of [{ type: '16th', dots: 0 }, { type: '32nd', dots: 0 }, { type: 'whole', dots: 0 }, { type: 'quarter', dots: 1 }]) {
    const placed = addTimelineNoteAt(score(), { ...createTimelineCursor(), placementValue: value }, 0, 60);
    assert.equal(convertFocusedTimelineTuplet(placed.project, placed.cursor), undefined);
  }
  const first = addTimelineNoteAt(score(), { ...createTimelineCursor(), placementValue: { type: 'quarter', dots: 0 } }, 0, 60);
  const tied = appendFocusedTimelineTie(first.project, first.cursor);
  assert.equal(convertFocusedTimelineTuplet(tied.project, first.cursor), undefined);
  assert.equal(convertFocusedTimelineTuplet(tied.project, { ...first.cursor, selectionAnchorNoteId: tied.cursor.focusedNoteId }), undefined);
});

test('group context fixes cursor movement and placement independently of the stored input unit', () => {
  let state = group();
  const original = { type: '32nd', dots: 0 };
  let cursor = { ...clear(state.cursor, 0), placementValue: original };
  assert.equal(getTimelineInputSixteenths(cursor, state.project.outline), 4 / 3);
  assert.deepEqual(getTimelineInputValue(cursor, state.project.outline), { type: 'eighth', dots: 0 });
  cursor = moveTimelineCursorHorizontally(cursor, state.project.outline, 1);
  assert.equal(cursor.positionSixteenths, 4 / 3);
  state = addTimelineNoteAt(state.project, cursor);
  assert.equal(notes(state)[1].note.value.type, 'eighth');
  assert.deepEqual(state.cursor.placementValue, original);
  cursor = clear(state.cursor, 8 / 3);
  cursor = moveTimelineCursorHorizontally(cursor, state.project.outline, 1);
  assert.equal(cursor.positionSixteenths, 4);
  assert.equal(getTimelineInputSixteenths(cursor, state.project.outline), 0.5);
  assert.equal(moveTimelineCursorHorizontally(cursor, state.project.outline, 1).positionSixteenths, 4.5);
  complete(state.project);
});

test('entering and exiting groups snaps to boundaries in both directions without fractional stranding', () => {
  const state = group('eighth', 2);
  let cursor = { ...clear(state.cursor, 0), placementValue: { type: 'quarter', dots: 0 } };
  cursor = moveTimelineCursorHorizontally(cursor, state.project.outline, 1);
  assert.equal(cursor.positionSixteenths, 2);
  for (let i = 0; i < 3; i++) cursor = moveTimelineCursorHorizontally(cursor, state.project.outline, 1);
  assert.equal(cursor.positionSixteenths, 6);
  assert.equal(moveTimelineCursorHorizontally(cursor, state.project.outline, 1).positionSixteenths, 10);
  cursor = moveTimelineCursorHorizontally({ ...cursor, positionSixteenths: 8 }, state.project.outline, -1);
  assert.equal(cursor.positionSixteenths, 6);
  for (let i = 0; i < 3; i++) cursor = moveTimelineCursorHorizontally(cursor, state.project.outline, -1);
  assert.equal(cursor.positionSixteenths, 2);
  assert.equal(moveTimelineCursorHorizontally(cursor, state.project.outline, -1).positionSixteenths, 0);
});

test('input changes and dot commands cannot change the effective group unit', () => {
  const state = group();
  const cursor = clear(state.cursor, 4 / 3);
  for (const key of ['1', '2', '3', '4']) {
    const changed = setTimelineCursorUnit(cursor, key);
    assert.equal(getTimelineInputSixteenths(changed, state.project.outline), 4 / 3);
    assert.deepEqual(toggleTimelineCursorDot(changed, state.project.outline), changed);
  }
  assert.equal(toggleFocusedTimelineNoteDot(state.project, state.cursor), undefined);
});

test('F extends one group cell at a time and collapses a sole full-span note into the original ordinary value', () => {
  let state = group();
  const noteId = state.cursor.focusedNoteId;
  const inputValue = { type: '32nd', dots: 0 };
  state.cursor = { ...state.cursor, placementValue: inputValue };
  state = resizeFocusedTimelineNote(state.project, state.cursor, 1);
  assert.equal(notes(state)[0].lengthSixteenths, 8 / 3);
  assert.equal(notes(state)[0].note.value.type, 'quarter');
  assert.equal(getTupletContext(state.project.outline, state.cursor) !== undefined, true);
  state = resizeFocusedTimelineNote(state.project, state.cursor, 1);
  assert.equal(getTupletContext(state.project.outline, state.cursor), undefined);
  assert.equal(notes(state)[0].lengthSixteenths, 4);
  assert.equal(notes(state)[0].note.id, noteId);
  assert.deepEqual(state.cursor.placementValue, inputValue);
  complete(state.project);
});

test('numeric duration changes permit whole cells, shrink restores rests and overlapping growth is atomic', () => {
  let state = group();
  state = setFocusedTimelineNoteType(state.project, state.cursor, '3');
  assert.equal(notes(state)[0].lengthSixteenths, 8 / 3);
  state = resizeFocusedTimelineNote(state.project, state.cursor, -1);
  assert.equal(notes(state)[0].lengthSixteenths, 4 / 3);
  assert.equal(setFocusedTimelineNoteType(state.project, state.cursor, '1'), undefined);
  const second = addTimelineNoteAt(state.project, clear(state.cursor, 4 / 3));
  const before = structuredClone(second.project);
  assert.equal(resizeFocusedTimelineNote(second.project, state.cursor, 1), undefined);
  assert.equal(setFocusedTimelineNoteType(second.project, state.cursor, '3'), undefined);
  assert.deepEqual(second.project, before);
  assert.equal(resizeFocusedTimelineNote(second.project, second.cursor, -1), undefined);
  complete(second.project);
});

test('single focused note uses internal movement even when it is the only note in the group', () => {
  const state = group();
  const moved = moveFocusedTimelineNote(state.project, state.cursor, 1);
  assert.equal(moved.cursor.positionSixteenths, 4 / 3);
  assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 0);
  const twice = moveFocusedTimelineNote(moved.project, moved.cursor, 1);
  assert.equal(twice.cursor.positionSixteenths, 8 / 3);
  assert.equal(moveFocusedTimelineNote(twice.project, twice.cursor, 1), undefined);
  complete(twice.project);
});

test('selecting all notes in cells one and two remains an internal move when the final cell is a rest', () => {
  let state = group();
  state = addTimelineNoteAt(state.project, clear(state.cursor, 4 / 3), undefined, 64);
  const cursor = select(state, 0, 1);
  const moved = moveFocusedTimelineNote(state.project, cursor, 1);
  assert.deepEqual(notes(moved).map((entry) => entry.positionSixteenths), [4 / 3, 8 / 3]);
  assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 0);
  complete(moved.project);
});

test('multi-selection touching both temporal edges moves the entire group by the ordinary cursor unit', () => {
  let state = group('eighth', 4);
  state = addTimelineNoteAt(state.project, clear(state.cursor, 4 + 8 / 3), undefined, 64);
  const cursor = { ...select(state, 0, 1), placementValue: { type: '16th', dots: 0 } };
  const id = getTupletContext(state.project.outline, cursor).group.id;
  const moved = moveFocusedTimelineNote(state.project, cursor, 1);
  const context = getTupletContext(moved.project.outline, moved.cursor);
  assert.equal(context.start, 5);
  assert.equal(context.group.id, id);
  assert.equal(context.group.elements.filter((element) => element.kind === 'rest').length, 1);
  assert.equal(moved.cursor.selectionAnchorNoteId, cursor.selectionAnchorNoteId);
  complete(moved.project);
});

test('group edge detection uses the end of a long note rather than the start of the last cell', () => {
  let state = group();
  state = addTimelineNoteAt(state.project, clear(state.cursor, 4 / 3), undefined, 64);
  state = setFocusedTimelineNoteType(state.project, state.cursor, '3');
  const moved = moveFocusedTimelineNote(state.project, { ...select(state, 0, 1), placementValue: { type: 'quarter', dots: 0 } }, 1);
  assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 4);
  complete(moved.project);
});

test('normal notes mixed with partially selected groups are rejected in either focus direction', () => {
  const first = group();
  const plain = addTimelineNoteAt(first.project, createTimelineCursor(), 8, 67);
  const cursor = { ...plain.cursor, selectionAnchorNoteId: first.cursor.focusedNoteId };
  assert.equal(moveFocusedTimelineNote(plain.project, cursor, 1), undefined);
  assert.equal(moveFocusedTimelineNote(plain.project, { ...first.cursor, selectionAnchorNoteId: plain.cursor.focusedNoteId }, 1), undefined);
  const second = group('eighth', 8, first.project);
  assert.equal(moveFocusedTimelineNote(second.project, { ...second.cursor, selectionAnchorNoteId: first.cursor.focusedNoteId }, 1), undefined);
});

test('complete groups mixed with ordinary notes move together by the normal unit in either focus direction', () => {
  let state = group();
  state = addTimelineNoteAt(state.project, clear(state.cursor, 8 / 3), undefined, 64);
  const ordinary = addTimelineNoteAt(state.project, createTimelineCursor(), 8, 67);
  state = ordinary;
  const sourceNotes = notes(state);
  const groupId = sourceNotes[0].tuplet.id;
  const before = structuredClone(state.project);
  for (const reversed of [false, true]) {
    const cursor = { ...select(state, 0, 2), placementValue: { type: 'quarter', dots: 0 } };
    if (reversed) {
      cursor.focusedNoteId = sourceNotes[0].note.id;
      cursor.selectionAnchorNoteId = sourceNotes[2].note.id;
      cursor.positionSixteenths = 0;
    }
    const moved = moveFocusedTimelineNote(state.project, cursor, 1);
    assert.ok(moved);
    const movedNotes = notes(moved);
    assert.deepEqual(movedNotes.map(({ note }) => note.id), sourceNotes.map(({ note }) => note.id));
    assert.equal(movedNotes[0].positionSixteenths, 4);
    assert.equal(movedNotes[0].tuplet.id, groupId);
    assert.equal(movedNotes[2].positionSixteenths, 12);
    assert.equal(moved.cursor.focusedNoteId, cursor.focusedNoteId);
    assert.equal(moved.cursor.selectionAnchorNoteId, cursor.selectionAnchorNoteId);
    const restored = moveFocusedTimelineNote(moved.project, moved.cursor, -1);
    assert.ok(restored);
    assert.equal(notes(restored)[0].positionSixteenths, 0);
    assert.equal(notes(restored)[2].positionSixteenths, 8);
    complete(moved.project);
    complete(restored.project);
  }
  assert.deepEqual(state.project, before);
});

test('every group must reach both edges when a selection contains multiple groups', () => {
  let first = group();
  first = addTimelineNoteAt(first.project, clear(first.cursor, 8 / 3), undefined, 64);
  const partial = group('eighth', 8, first.project);
  const ordinaryPartial = addTimelineNoteAt(partial.project, createTimelineCursor(), 16, 67);
  const rejected = select(ordinaryPartial, 0, 3);
  assert.equal(moveFocusedTimelineNote(ordinaryPartial.project, rejected, 1), undefined);
  const full = addTimelineNoteAt(ordinaryPartial.project, clear(partial.cursor, 8 + 8 / 3), undefined, 65);
  const cursor = { ...select(full, 0, 4), placementValue: { type: 'quarter', dots: 0 } };
  const moved = moveFocusedTimelineNote(full.project, cursor, 1);
  assert.ok(moved);
  assert.deepEqual(notes(moved).map((entry) => entry.measureStartSixteenths + entry.positionSixteenths), [4, 20 / 3, 12, 44 / 3, 20]);
  complete(moved.project);
});

test('a failed destination for any mixed atom rejects the entire edit without vacating its sources', () => {
  let state = group();
  state = addTimelineNoteAt(state.project, clear(state.cursor, 8 / 3), undefined, 64);
  state = addTimelineNoteAt(state.project, createTimelineCursor(), 8, 67);
  const cursor = { ...select(state, 0, 2), placementValue: { type: 'quarter', dots: 0 } };
  const blocked = addTimelineNoteAt(state.project, createTimelineCursor(), 12, 70);
  const before = structuredClone(blocked.project);
  assert.equal(moveFocusedTimelineNote(blocked.project, cursor, 1), undefined);
  assert.deepEqual(blocked.project, before);
  const atEnd = addTimelineNoteAt(state.project, createTimelineCursor(), 47, 72);
  const endCursor = { ...select(atEnd, 0, 3), placementValue: { type: 'quarter', dots: 0 } };
  assert.equal(moveFocusedTimelineNote(atEnd.project, endCursor, 1), undefined);
  const lower = addTimelineNoteAt(state.project, createTimelineCursor('lowerStaff'), 12, 67);
  assert.equal(moveFocusedTimelineNote(lower.project, cursor, 1), undefined);
});

test('internal moves and duration edits preserve cross-staff and cross-voice same-pitch collision checks', () => {
  let state = group();
  const lower = addTimelineNoteAt(state.project, { ...createTimelineCursor('lowerStaff'), placementValue: { type: 'eighth', dots: 0 } }, 2, 60);
  assert.equal(moveFocusedTimelineNote(lower.project, state.cursor, 1), undefined);
  assert.equal(resizeFocusedTimelineNote(lower.project, state.cursor, 1), undefined);
  assert.equal(setFocusedTimelineNoteType(lower.project, state.cursor, '3'), undefined);
  const before = structuredClone(lower.project);
  assert.equal(addTimelineNoteAt(lower.project, clear(state.cursor, 8 / 3)), undefined);
  assert.deepEqual(lower.project, before);
});

test('whole groups reject occupied destinations, score end and missing destination voices atomically', () => {
  let state = group('eighth', 12);
  state = addTimelineNoteAt(state.project, clear(state.cursor, 12 + 8 / 3), undefined, 64);
  const cursor = { ...select(state, 0, 1), placementValue: { type: 'quarter', dots: 0 } };
  const moved = moveFocusedTimelineNote(state.project, cursor, 1);
  assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 16);
  const blocked = addTimelineNoteAt(state.project, createTimelineCursor(), 16, 67);
  assert.equal(moveFocusedTimelineNote(blocked.project, cursor, 1), undefined);
  const voiceProject = addNextTimelineVoice(score(), createTimelineCursor());
  let other = group('eighth', 12, voiceProject, { voiceIndex: 1 });
  other = addTimelineNoteAt(other.project, clear(other.cursor, 12 + 8 / 3), undefined, 64);
  assert.equal(moveFocusedTimelineNote(other.project, { ...select(other, 0, 1), placementValue: { type: 'quarter', dots: 0 } }, 1), undefined);
  const back = moveFocusedTimelineNote(moved.project, moved.cursor, -1);
  assert.ok(back);
  complete(back.project);
});

test('the same edge rule handles quintuplets and septuplets, including internal all-note selections', () => {
  for (const actual of [5, 7]) {
    const project = score();
    const elements = Array.from({ length: actual }, (_, index) => index === 0 || index === actual - 1
      ? { id: 'n' + index, kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 60 + index }] }
      : { id: 'r' + index, kind: 'rest', value: { type: 'eighth', dots: 0 } });
    project.outline[2].data.upperStaff.voices[0].elements = [{ id: 'g', kind: 'tuplet', actual, normal: 4, baseType: 'eighth', elements }, ...createRestElements(8, 8)];
    const cursor = { ...createTimelineCursor(), focusedNoteId: 'n' + (actual - 1), selectionAnchorNoteId: 'n0', focusedPitchIndex: null, positionSixteenths: 8 * (actual - 1) / actual };
    const moved = moveFocusedTimelineNote(project, cursor, 1);
    assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 1);
    complete(moved.project);
  }
});

test('deleting the last note still dissolves the group, preserves following notes and permits ordinary input', () => {
  let state = group('eighth', 1);
  const first = state.cursor;
  state = addTimelineNoteAt(state.project, clear(state.cursor, 1 + 4 / 3), undefined, 64);
  const last = state.cursor;
  state = deleteFocusedTimelineNote(state.project, first);
  assert.ok(getTupletContext(state.project.outline, last));
  state = deleteFocusedTimelineNote(state.project, last);
  assert.equal(state.cursor.positionSixteenths, 1);
  assert.equal(getTupletContext(state.project.outline, state.cursor), undefined);
  assert.ok(addTimelineNoteAt(state.project, { ...state.cursor, placementValue: { type: '16th', dots: 0 } }));
  complete(state.project);
});

test('chord edits, grouped ties and range deletion keep exact voice duration and repair ties', () => {
  let state = group();
  const first = state.cursor;
  state = appendFocusedTimelineTie(state.project, state.cursor);
  state = addFocusedNotePitch(state.project, state.cursor);
  state = moveFocusedTimelineNotePitch(state.project, state.cursor, -1);
  assert.equal(notes(state)[0].note.pitches.length, 2);
  const cursor = { ...state.cursor, selectionAnchorNoteId: first.focusedNoteId, focusedPitchIndex: null };
  const removed = deleteFocusedTimelineNote(state.project, cursor);
  assert.equal(getLocatedTimelineNotes(removed.project.outline).length, 0);
  complete(removed.project);
});

test('switching to a voice or staff with no group cannot strand a fractional cursor', () => {
  const project = addNextTimelineVoice(score(), createTimelineCursor());
  let state = group('eighth', 0, project);
  state = addTimelineNoteAt(state.project, clear(state.cursor, 4 / 3), undefined, 64);
  const otherVoice = cycleTimelineVoice(state.project.outline, state.cursor);
  const otherStaff = switchTimelineStaff(state.project.outline, state.cursor);
  assert.equal(otherVoice.positionSixteenths, 0);
  assert.equal(otherStaff.positionSixteenths, 0);
  assert.equal(getTupletContext(state.project.outline, otherVoice), undefined);
});

test('MusicXML keeps integer durations and renders group notation without persisted note onsets', () => {
  const state = group('16th');
  const xml = createScorePreview(state.project.outline, 0).xml;
  assert.match(xml, /<divisions>24<\/divisions>/);
  assert.match(xml, /<actual-notes>3<\/actual-notes><normal-notes>2<\/normal-notes>/);
  assert.match(xml, /<normal-type>16th<\/normal-type>/);
  assert.match(xml, /<tuplet type="start" bracket="yes"\/>/);
  assert.equal([...xml.matchAll(/<duration>([^<]+)<\/duration>/g)].every((match) => Number.isInteger(Number(match[1]))), true);
  complete(state.project);
});

test('ordinary normalization and measure shrinking never truncate a group', () => {
  const state = group('eighth', 12);
  assert.equal(resizeFocusedTimelineTie(state.project, state.cursor, 1), undefined);
  assert.equal(changeOutlineMeasureBeats(state.project.outline, { blockId: 'm0' }, -1), state.project.outline);
});

test('all notes selected without both edges still uses internal steps for five and seven subdivisions', () => {
  for (const actual of [5, 7]) {
    const project = score();
    project.outline[2].data.upperStaff.voices[0].elements = [{ id: 'g', kind: 'tuplet', actual, normal: 4, baseType: 'eighth',
      elements: Array.from({ length: actual }, (_, index) => index < 2
        ? { id: 'n' + index, kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 60 + index }] }
        : { id: 'r' + index, kind: 'rest', value: { type: 'eighth', dots: 0 } }),
    }, ...createRestElements(8, 8)];
    const cursor = { ...createTimelineCursor(), focusedNoteId: 'n1', selectionAnchorNoteId: 'n0', focusedPitchIndex: null, positionSixteenths: 8 / actual,
      placementValue: { type: 'quarter', dots: 0 } };
    const moved = moveFocusedTimelineNote(project, cursor, 1);
    assert.equal(getTupletContext(moved.project.outline, moved.cursor).start, 0);
    assert.equal(notes(moved)[0].positionSixteenths, 8 / actual);
    complete(moved.project);
  }
});

test('whole-group moves reject a same-pitch overlap on the other staff and retain the source', () => {
  let state = group('eighth', 0);
  state = addTimelineNoteAt(state.project, clear(state.cursor, 8 / 3), undefined, 64);
  const lower = addTimelineNoteAt(state.project, { ...createTimelineCursor('lowerStaff'), placementValue: { type: 'eighth', dots: 0 } }, 4, 60);
  const cursor = { ...select(state, 0, 1), placementValue: { type: 'quarter', dots: 0 } };
  const before = structuredClone(lower.project);
  assert.equal(moveFocusedTimelineNote(lower.project, cursor, 1), undefined);
  assert.deepEqual(lower.project, before);
});

test('repeated fixed steps across neighboring groups and bars do not accumulate fractional drift', () => {
  let project = score(11);
  for (let position = 0; position < 160; position += 2) project = group('16th', position, project).project;
  let cursor = { ...createTimelineCursor(), placementValue: { type: 'quarter', dots: 0 } };
  for (let index = 0; index < 240; index++) cursor = moveTimelineCursorHorizontally(cursor, project.outline, 1);
  assert.equal(cursor.positionSixteenths, 160);
  complete(project);
});

test('internal editing preserves unrelated explicit rest spelling inside the group', () => {
  const state = group();
  const context = getTupletContext(state.project.outline, state.cursor);
  context.group.elements = [context.group.elements[0],
    { id: 'keep-a', kind: 'rest', value: { type: '16th', dots: 0 } },
    { id: 'keep-b', kind: 'rest', value: { type: '16th', dots: 0 } }, context.group.elements[2]];
  const added = addTimelineNoteAt(state.project, clear(state.cursor, 8 / 3));
  const updated = getTupletContext(added.project.outline, added.cursor).group;
  assert.deepEqual(updated.elements.slice(1, 3).map((element) => element.id), ['keep-a', 'keep-b']);
  complete(added.project);
});

function ordinaryAfterTiedTuplet() {
  let state = group();
  state = addTimelineNoteAt(state.project, clear(state.cursor, 8 / 3));
  const tailCursor = state.cursor;
  state = addTimelineNoteAt(state.project, createTimelineCursor(), 4, 60);
  const project = toggleTieToAdjacentTimelineNote(state.project, tailCursor);
  assert.ok(project);
  return { project, cursor: state.cursor, tailId: tailCursor.focusedNoteId };
}

test('F resize, digits and dots edit an ordinary note tied from a tuplet without rewriting the group', () => {
  const initial = ordinaryAfterTiedTuplet();
  const originalGroup = structuredClone(initial.project.outline[2].data.upperStaff.voices[0].elements[0]);
  let state = resizeFocusedTimelineNote(initial.project, initial.cursor, 1);
  assert.equal(getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).note.value.type, 'eighth');
  state = resizeFocusedTimelineNote(state.project, state.cursor, -1);
  assert.equal(getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).note.value.type, '16th');
  state = setFocusedTimelineNoteType(state.project, state.cursor, '3');
  state = toggleFocusedTimelineNoteDot(state.project, state.cursor);
  assert.deepEqual(getLocatedTimelineNote(state.project.outline, state.cursor.focusedNoteId).note.value, { type: 'quarter', dots: 1 });
  assert.deepEqual(state.project.outline[2].data.upperStaff.voices[0].elements[0], originalGroup);
  assert.deepEqual(state.cursor.placementValue, initial.cursor.placementValue);
  const reconciled = reconcileOutlineTies(state.project.outline);
  assert.equal(getLocatedTimelineNote(reconciled, state.cursor.focusedNoteId).note.tieFrom, initial.tailId);
  assert.equal(getLocatedTimelineNote(reconciled, initial.tailId).note.tieTo, state.cursor.focusedNoteId);
  complete(state.project);
});

test('editing an ordinary interior note after a tuplet moves only ordinary tie successors and checks collisions', () => {
  const initial = ordinaryAfterTiedTuplet();
  const withTail = appendFocusedTimelineTie(initial.project, initial.cursor);
  const originalGroup = structuredClone(withTail.project.outline[2].data.upperStaff.voices[0].elements[0]);
  const edited = setFocusedTimelineNoteType(withTail.project, initial.cursor, '2');
  assert.ok(edited);
  assert.equal(getLocatedTimelineNote(edited.project.outline, withTail.cursor.focusedNoteId).positionSixteenths, 6);
  assert.deepEqual(edited.project.outline[2].data.upperStaff.voices[0].elements[0], originalGroup);
  const blocker = addTimelineNoteAt(withTail.project, createTimelineCursor('lowerStaff'), 6, 60);
  const before = structuredClone(blocker.project);
  assert.equal(setFocusedTimelineNoteType(blocker.project, initial.cursor, '2'), undefined);
  assert.deepEqual(blocker.project, before);
  complete(edited.project);
});

test('input display stays fixed for cursor, single focus and partial ranges but returns to normal for both edges', () => {
  const first = group();
  assert.ok(getTimelineFixedInputContext(first.cursor, first.project.outline));
  assert.ok(getTimelineFixedInputContext(clear(first.cursor, 4 / 3), first.project.outline));
  const second = addTimelineNoteAt(first.project, clear(first.cursor, 4 / 3));
  const partial = select(second, 0, 1);
  assert.ok(getTimelineFixedInputContext(partial, second.project.outline));
  assert.deepEqual(getTimelineInputValue(partial, second.project.outline), { type: 'eighth', dots: 0 });
  const last = addTimelineNoteAt(second.project, clear(second.cursor, 8 / 3));
  const full = { ...select(last, 0, 2), placementValue: { type: '32nd', dots: 0 } };
  assert.equal(getTimelineFixedInputContext(full, last.project.outline), undefined);
  assert.deepEqual(getTimelineInputValue(full, last.project.outline), full.placementValue);
  const reverse = { ...full, focusedNoteId: notes(last)[0].note.id, selectionAnchorNoteId: notes(last)[2].note.id, positionSixteenths: 0 };
  assert.equal(getTimelineFixedInputContext(reverse, last.project.outline), undefined);
  const single = { ...full, selectionAnchorNoteId: null };
  assert.ok(getTimelineFixedInputContext(single, last.project.outline));
});

test('mixed range input displays the normal cursor value even when its focus is a tuplet note', () => {
  const first = group();
  const ordinary = addTimelineNoteAt(first.project, createTimelineCursor(), 8, 67);
  const mixed = { ...first.cursor, selectionAnchorNoteId: ordinary.cursor.focusedNoteId, placementValue: { type: 'quarter', dots: 1 } };
  assert.equal(getTimelineFixedInputContext(mixed, ordinary.project.outline), undefined);
  assert.deepEqual(getTimelineInputValue(mixed, ordinary.project.outline), mixed.placementValue);
  const reverse = { ...mixed, focusedNoteId: ordinary.cursor.focusedNoteId, selectionAnchorNoteId: first.cursor.focusedNoteId, positionSixteenths: 8 };
  assert.equal(getTimelineFixedInputContext(reverse, ordinary.project.outline), undefined);
  assert.deepEqual(getTimelineInputValue(reverse, ordinary.project.outline), mixed.placementValue);
});
