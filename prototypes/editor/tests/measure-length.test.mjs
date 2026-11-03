import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProject, createMeasureData, createRestElements, getElementSixteenths, getLocatedVoiceElements,
} from '../src/model/project.ts';
import { changeOutlineMeasureBeats } from '../src/state/outline-cursor.ts';
import { getMeasureBeatDisplay } from '../src/state/measure-beats.ts';

function projectWithMeasures(meter = { cnt: 4, unit: 4 }, lengths = [meter]) {
  const project = createProject();
  project.outline[0].data.timeSignature = { ...meter };
  lengths.forEach((length, index) => project.outline.push({ id: `m${index}`, type: 'measure', data: createMeasureData(length) }));
  return project;
}
function assertComplete(outline) {
  for (const block of outline) {
    if (block.type !== 'measure') continue;
    for (const staff of [block.data.upperStaff, block.data.lowerStaff]) {
      for (const voice of staff.voices) {
        assert.equal(voice.elements.reduce((sum, element) => sum + getElementSixteenths(element, block.data.length), 0),
          block.data.length.cnt / block.data.length.unit * 16);
      }
    }
  }
}
function putNote(block, staff, voiceIndex, at, value = { type: 'quarter', dots: 0 }) {
  while (block.data[staff].voices.length <= voiceIndex) {
    const voice = createMeasureData(block.data.length).upperStaff.voices[0];
    block.data[staff].voices.push({ ...voice, id: `voice-${block.data[staff].voices.length}` });
  }
  const voice = block.data[staff].voices[voiceIndex];
  const length = getElementSixteenths({ id: 'temp', kind: 'rest', value }, block.data.length);
  const note = { id: `${block.id}-${staff}-${voiceIndex}-note`, kind: 'note', value, pitches: [{ midi: 60, fingering: 2 }] };
  voice.elements = [
    ...createRestElements(0, at), note,
    ...createRestElements(at + length, block.data.length.cnt / block.data.length.unit * 16 - at - length),
  ];
  return note;
}

test('one-beat resizing uses perceived beats for every supported meter and stops at one and the standard count', () => {
  for (const [cnt, unit] of [[2, 4], [3, 4], [4, 4], [3, 8], [6, 8], [9, 8], [12, 8]]) {
    const project = projectWithMeasures({ cnt, unit });
    const cursor = { blockId: 'm0' };
    let outline = project.outline;
    const standard = getMeasureBeatDisplay({ cnt, unit }, { cnt, unit }).standardBeats;
    const restIds = outline[2].data.upperStaff.voices[0].elements.map(element => element.id);
    assert.equal(changeOutlineMeasureBeats(outline, cursor, 1), outline);
    for (let actual = standard - 1; actual >= 1; actual--) {
      outline = changeOutlineMeasureBeats(outline, cursor, -1);
      assert.equal(getMeasureBeatDisplay({ cnt, unit }, outline[2].data.length).actualBeats, actual);
      assertComplete(outline);
    }
    assert.equal(changeOutlineMeasureBeats(outline, cursor, -1), outline);
    for (let actual = 2; actual <= standard; actual++) {
      outline = changeOutlineMeasureBeats(outline, cursor, 1);
      assert.equal(getMeasureBeatDisplay({ cnt, unit }, outline[2].data.length).actualBeats, actual);
      assertComplete(outline);
    }
    assert.deepEqual(outline[2].data.upperStaff.voices[0].elements.map(element => element.id), restIds);
    assert.deepEqual(project.outline[2].data.length, { cnt, unit });
  }
});

test('a note that starts before the new boundary but ends beyond it rejects shortening in every staff and voice', () => {
  for (const staff of ['upperStaff', 'lowerStaff']) {
    for (const voiceIndex of [0, 1, 2]) {
      const { outline } = projectWithMeasures();
      putNote(outline[2], staff, voiceIndex, 9);
      const before = structuredClone(outline);
      assert.equal(changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1), outline);
      assert.deepEqual(outline, before);
      assertComplete(outline);
    }
  }
});

test('notes entirely in the removed tail also reject shortening without partial edits', () => {
  const { outline } = projectWithMeasures();
  putNote(outline[2], 'lowerStaff', 2, 14, { type: 'eighth', dots: 0 });
  const before = structuredClone(outline);
  assert.equal(changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1), outline);
  assert.deepEqual(outline, before);
});

test('a note ending exactly on the new boundary is retained with its identity, chord and fingering', () => {
  const { outline } = projectWithMeasures();
  const note = putNote(outline[2], 'upperStaff', 0, 8);
  note.pitches.push({ midi: 55, fingering: 1 });
  const before = structuredClone(outline);
  const shorter = changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1);
  const entries = getLocatedVoiceElements(shorter[2].data.upperStaff.voices[0], shorter[2].data.length);
  assert.equal(entries.find(entry => entry.element.id === note.id).positionSixteenths, 8);
  assert.deepEqual(entries.find(entry => entry.element.id === note.id).element, note);
  assert.deepEqual(shorter[2].data.length, { cnt: 3, unit: 4 });
  assert.deepEqual(outline, before);
  assertComplete(shorter);
});

test('shrinking clips only the crossing rest and growing appends rests without rewriting existing spelling', () => {
  const { outline } = projectWithMeasures();
  const voice = outline[2].data.upperStaff.voices[0];
  voice.elements = [
    { id: 'first-rest', kind: 'rest', value: { type: 'quarter', dots: 0 } },
    { id: 'note', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 60 }] },
    { id: 'crossing-rest', kind: 'rest', value: { type: 'half', dots: 0 } },
  ];
  const shorter = changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1);
  const elements = shorter[2].data.upperStaff.voices[0].elements;
  assert.deepEqual(elements.slice(0, 2), voice.elements.slice(0, 2));
  assert.deepEqual(elements[2].value, { type: 'quarter', dots: 0 });
  assert.notEqual(elements[2].id, 'crossing-rest');
  const longer = changeOutlineMeasureBeats(shorter, { blockId: 'm0' }, 1);
  assert.deepEqual(longer[2].data.upperStaff.voices[0].elements.slice(0, 3), elements);
  assert.equal(longer[2].data.upperStaff.voices[0].elements.length, 4);
  assertComplete(shorter);
  assertComplete(longer);
});

test('growing a bar detaches a formerly adjacent outgoing tie and preserves the next bar’s local notes and length', () => {
  const { outline } = projectWithMeasures({ cnt: 4, unit: 4 }, [{ cnt: 3, unit: 4 }, { cnt: 4, unit: 4 }]);
  const tail = putNote(outline[2], 'upperStaff', 0, 8);
  const head = putNote(outline[3], 'upperStaff', 0, 0);
  tail.tieTo = head.id;
  head.tieFrom = tail.id;
  const before = structuredClone(outline);
  const longer = changeOutlineMeasureBeats(outline, { blockId: 'm0' }, 1);
  const afterTail = longer[2].data.upperStaff.voices[0].elements.find(element => element.kind === 'note');
  const afterHead = longer[3].data.upperStaff.voices[0].elements.find(element => element.kind === 'note');
  assert.equal(afterTail.tieTo, undefined);
  assert.equal(afterHead.tieFrom, undefined);
  const expectedHead = { ...head };
  delete expectedHead.tieFrom;
  assert.deepEqual(afterHead, expectedHead);
  assert.deepEqual(longer[3].data.length, outline[3].data.length);
  assert.equal(getLocatedVoiceElements(longer[3].data.upperStaff.voices[0], longer[3].data.length).find(entry => entry.element.kind === 'note').positionSixteenths, 0);
  assert.deepEqual(outline, before);
  assert.equal(changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1), outline);
  assertComplete(longer);
});

test('only a focused measure can resize, preserving the initial meter and other blocks', () => {
  const { outline } = projectWithMeasures({ cnt: 6, unit: 8 }, [{ cnt: 6, unit: 8 }, { cnt: 6, unit: 8 }]);
  for (const blockId of [outline[0].id, outline[1].id, 'missing']) {
    assert.equal(changeOutlineMeasureBeats(outline, { blockId }, -1), outline);
  }
  const shorter = changeOutlineMeasureBeats(outline, { blockId: 'm0' }, -1);
  assert.deepEqual(shorter[0], outline[0]);
  assert.deepEqual(shorter[3], outline[3]);
  assert.deepEqual(shorter[2].data.length, { cnt: 3, unit: 8 });
  assertComplete(shorter);
});
