import assert from 'node:assert/strict';
import { test } from 'node:test';
import Factory from '../src/domain/score/score-project.ts';
import Measure from '../src/domain/score/score-measure.ts';
import Rest from '../src/domain/score/rest-spelling.ts';
import Written from '../src/domain/theory/written-value.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Fermata from '../src/domain/score/score-fermata.ts';
import Integrity from '../src/domain/score/score-integrity.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import Editing from '../src/action/editor/score-editing.ts';
import Authoring from '../src/action/editor/score-authoring.ts';
import Reader from '../src/service/mcp/mcp-score-reader.ts';
import NoteSettings from '../src/state/note-settings.ts';
import { getExpressionRows } from '../src/state/expression-editor.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';

function score(specs) {
  const project = Factory.create(), data = Measure.create({ cnt: 4, unit: 4 });
  for (const staff of ['upperStaff', 'lowerStaff']) {
    const count = Math.max(1, ...specs.filter(s => s.staff === staff).map(s => (s.voice ?? 0) + 1));
    data[staff].voices = Array.from({ length: count }, (_, voice) => {
      const elements = []; let position = 0;
      for (const spec of specs.filter(s => s.staff === staff && (s.voice ?? 0) === voice).sort((a, b) => a.start - b.start)) {
        elements.push(...Rest.create(position, spec.start - position));
        const value = { type: spec.type ?? 'quarter', dots: spec.dots ?? 0 };
        elements.push({ id: spec.id, kind: 'note', value, pitches: [{ midi: staff === 'upperStaff' ? 72 + voice * 4 : 48 + voice * 4 }],
          ...(spec.ratio !== undefined ? { fermata: { lengthRatio: spec.ratio } } : {}) });
        position = spec.start + Written.sixteenths(value);
      }
      elements.push(...Rest.create(position, 16 - position));
      return { id: `voice-${voice}`, elements };
    });
  }
  project.outline.push({ id: 'm', type: 'measure', data }, { id: 'm2', type: 'measure', data: Measure.create({ cnt: 4, unit: 4 }) });
  return project;
}
function cursor(project, id) {
  for (const staff of ['upperStaff', 'lowerStaff']) {
    const entry = Timeline.allNotes(project.outline, staff).find(e => e.note.id === id);
    if (entry) return { ...createTimelineCursor(), staff, voiceIndex: entry.voiceIndex, focusedNoteId: id,
      focusedPitchIndex: 0, positionSixteenths: entry.measureStartSixteenths + entry.positionSixteenths };
  }
  throw Error('Missing note');
}
const find = (p, id) => Timeline.note(p.outline, id, 'upperStaff')?.note ?? Timeline.note(p.outline, id, 'lowerStaff')?.note;
const edit = (p, operations) => Editing.apply(p, Authoring.createState(), operations);
const press = (p, editor, key, shiftKey = false) => NoteSettings.control(p, editor,
  { key, shiftKey, repeat: false, isComposing: false, altKey: false, ctrlKey: false, metaKey: false });

test('shared ends merge the entire range and use voice order before staff order', () => {
  let p = score([
    { id: 'upper', staff: 'upperStaff', start: 12, ratio: 2 },
    { id: 'lower', staff: 'lowerStaff', start: 0, type: 'whole', ratio: 3 },
    { id: 'voice2', staff: 'upperStaff', voice: 1, start: 8, type: 'half', ratio: 4 },
  ]);
  Integrity.validate(p);
  assert.equal(Fermata.hasConflicts(p), false);
  let [group] = Fermata.groups(p);
  assert.equal(group.priorityNoteId, 'upper'); assert.equal(group.lengthRatio, 2);
  assert.equal(group.startSixteenths, 0); assert.equal(group.endSixteenths, 16);
  const read = Reader.range(p, { firstMeasure: 1, measureCount: 1, staff: 'lowerStaff' }).fermataGroups[0];
  assert.equal(read.priorityNoteId, 'upper'); assert.deepEqual(read.start, { numerator: 0, denominator: 1 });
  assert.deepEqual(read.end, { numerator: 4, denominator: 1 });
  p = edit(p, [{ type: 'set_note_expression', noteId: 'upper', fermata: null }]).project;
  [group] = Fermata.groups(p);
  assert.equal(group.priorityNoteId, 'lower'); assert.equal(group.lengthRatio, 3);
  const preview = Fermata.groups(p, { noteId: 'voice2', settings: { lengthRatio: 1.2 } })[0];
  assert.equal(preview.lengthRatio, 3); // A draft in voice 2 cannot override voice 1.
});

test('partial overlaps, containment with different ends and staggered chains are rejected; adjacent holds remain independent', () => {
  for (const specs of [
    [{ id: 'a', staff: 'upperStaff', start: 0, type: 'half', ratio: 2 }, { id: 'b', staff: 'lowerStaff', start: 4, type: 'half', ratio: 3 }],
    [{ id: 'a', staff: 'upperStaff', start: 0, type: 'whole', ratio: 2 }, { id: 'b', staff: 'lowerStaff', start: 4, ratio: 3 }],
    [{ id: 'a', staff: 'upperStaff', start: 0, type: 'half', ratio: 2 }, { id: 'b', staff: 'lowerStaff', start: 4, type: 'half', ratio: 3 },
      { id: 'c', staff: 'upperStaff', voice: 1, start: 8, type: 'half', ratio: 4 }],
  ]) {
    const p = score(specs); assert.equal(Fermata.hasConflicts(p), true); assert.throws(() => Integrity.validate(p));
  }
  const adjacent = score([{ id: 'a', staff: 'upperStaff', start: 0, ratio: 2 }, { id: 'b', staff: 'lowerStaff', start: 4, ratio: 3 }]);
  assert.equal(Fermata.hasConflicts(adjacent), false); assert.equal(Fermata.groups(adjacent).length, 2);
});

test('B menu disables incompatible additions and revalidates a stale modal at Enter and commit', () => {
  const p = score([{ id: 'a', staff: 'upperStaff', start: 0, type: 'half' }, { id: 'b', staff: 'lowerStaff', start: 4, type: 'half' }]);
  const target = cursor(p, 'b');
  let editor = NoteSettings.open(p, target);
  editor.expression.row = getExpressionRows(editor.expression, find(p, 'b'), p).findIndex(row => row.id === 'fermata');
  const changed = edit(p, [{ type: 'set_note_expression', noteId: 'a', fermata: { lengthRatio: 2 } }]).project;
  const row = getExpressionRows(editor.expression, find(changed, 'b'), changed).find(row => row.id === 'fermata');
  assert.equal(row.disabled, true);
  assert.equal(press(changed, editor, 'Enter').editor.expression.draft.fermata, undefined);
  editor.expression.draft.fermata = { lengthRatio: 2 };
  assert.ok(press(changed, editor, 'Enter', true).editor.expression.error);
  assert.equal(NoteEditor.configure(changed, target, { fermata: { lengthRatio: 2 } }), changed);
  assert.throws(() => edit(changed, [{ type: 'set_note_expression', noteId: 'b', fermata: { lengthRatio: 2 } }]));
  assert.equal(find(changed, 'b').fermata, undefined);
});

test('moving, resizing and dot changes delete fermatas; pitch changes and chord additions retain them', () => {
  const p = score([{ id: 'a', staff: 'upperStaff', start: 0, ratio: 2 }]), c = cursor(p, 'a');
  for (const result of [NoteEditor.move(p, c, 1), NoteEditor.setValue(p, c, { type: 'eighth', dots: 0 }), NoteEditor.toggleDot(p, c)]) {
    assert.equal(find(result.project, 'a').fermata, undefined);
  }
  for (const result of [NoteEditor.movePitch(p, c, 1), NoteEditor.addPitch(p, c)]) {
    assert.deepEqual(find(result.project, 'a').fermata, { lengthRatio: 2 });
  }
  assert.deepEqual(find(p, 'a').fermata, { lengthRatio: 2 });
});

test('editing a tied predecessor removes the shifted tail fermata while unchanged normalization preserves it', () => {
  const p = score([{ id: 'a', staff: 'upperStaff', start: 0 }, { id: 'b', staff: 'upperStaff', start: 4, ratio: 2 }]);
  find(p, 'a').tieTo = 'b'; find(p, 'b').tieFrom = 'a';
  const changed = NoteEditor.setValue(p, cursor(p, 'a'), { type: 'half', dots: 0 }).project;
  assert.equal(find(changed, 'b').fermata, undefined);
  const normalized = NoteEditor.normalizeTie(p, cursor(p, 'b')).project;
  assert.deepEqual(find(normalized, 'b').fermata, { lengthRatio: 2 });
});

test('MCP timing edits delete shifted attachments, report removals, and permit an explicit reapplication afterwards', () => {
  const p = score([{ id: 'a', staff: 'upperStaff', start: 0 }, { id: 'b', staff: 'upperStaff', start: 4, ratio: 3 }]);
  const operations = [
    { type: 'set_value', elementId: 'a', value: '8' },
    { type: 'set_value', elementId: 'b', value: '4.' },
  ];
  const changed = edit(p, operations);
  assert.equal(find(changed.project, 'b').fermata, undefined);
  assert.ok(changed.summary.removedNoteAttachments.some(entry => entry.noteId === 'b' && entry.fields.includes('fermata')));
  const reapplied = edit(p, [...operations, { type: 'set_note_expression', noteId: 'b', fermata: { lengthRatio: 2 } }]).project;
  assert.deepEqual(find(reapplied, 'b').fermata, { lengthRatio: 2 });
  const shifted = edit(p, [{ type: 'insert_measures', afterMeasureId: null, measures: [{}] }]).project;
  assert.equal(find(shifted, 'b').fermata, undefined);
  const pitched = edit(p, [{ type: 'set_pitches', noteId: 'b', pitches: ['D5', 'F5'] }]).project;
  assert.deepEqual(find(pitched, 'b').fermata, { lengthRatio: 3 });
});

test('fractional tuplet ends compare exactly across layers', () => {
  const p = score([{ id: 'a', staff: 'upperStaff', start: 0, ratio: 2 }]);
  p.outline[2].data.lowerStaff.voices[0].elements = [{ id: 'tuplet', kind: 'tuplet', actual: 3, normal: 2, baseType: 'eighth',
    elements: Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, kind: 'note', value: { type: 'eighth', dots: 0 }, pitches: [{ midi: 48 }],
      ...(i === 2 ? { fermata: { lengthRatio: 3 } } : {}) })) }, ...Rest.create(4, 12)];
  Integrity.validate(p); assert.equal(Fermata.conflict(p, 'a'), false);
  assert.equal(Fermata.groups(p)[0].noteIds.length, 2);
});

test('passage paste refuses a newly conflicting fermata without exposing a cursor to rejected notes', () => {
  const source = score([{ id: 'src', staff: 'lowerStaff', start: 0, ratio: 3 }]);
  const passage = NoteEditor.copyPassage(source, cursor(source, 'src'));
  const target = score([{ id: 'upper', staff: 'upperStaff', start: 4, ratio: 2 }]);
  const destination = { ...createTimelineCursor(), staff: 'lowerStaff', positionSixteenths: 6 };
  const rejected = NoteEditor.pastePassage(target, destination, passage);
  assert.deepEqual(rejected, { ok: false, reason: 'invalid-passage' });
  const allowed = NoteEditor.pastePassage(target, { ...destination, positionSixteenths: 4 }, passage);
  assert.equal(allowed.ok, true); assert.equal(Fermata.groups(allowed.project)[0].lengthRatio, 2);
});
