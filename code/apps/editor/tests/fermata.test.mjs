import assert from 'node:assert/strict';
import { test } from 'node:test';
import Factory from '../src/domain/score/score-project.ts';
import Measure from '../src/domain/score/score-measure.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Validator from '../src/domain/score/score-project-validator.ts';
import Integrity from '../src/domain/score/score-integrity.ts';
import Fermata from '../src/domain/score/score-fermata.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import Editing from '../src/action/editor/score-editing.ts';
import Authoring from '../src/action/editor/score-authoring.ts';
import Reader from '../src/service/mcp/mcp-score-reader.ts';
import NoteSettings from '../src/state/note-settings.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import { createExpressionEditor, controlExpressionEditor, getExpressionRows, validateExpressionDraft,
  fermataFromDraft } from '../src/state/expression-editor.ts';
import Preview from '../src/infra/musicxml/preview-musicxml.ts';
import Plan from '../src/domain/performance/score-playback-plan.ts';

function fixture(type = 'quarter', dots = 0) {
  const project = Factory.create();
  for (let i = 0; i < 3; i++) project.outline.push({ id: `m${i}`, type: 'measure', data: Measure.create({ cnt: 4, unit: 4 }) });
  return NoteEditor.add(project, { ...createTimelineCursor(), placementValue: { type, dots } });
}
const note = state => Timeline.note(state.project.outline, state.cursor.focusedNoteId).note;
const edit = (project, operations) => Editing.apply(project, Authoring.createState(), operations).project;
const selectFermata = n => {
  const editor = createExpressionEditor(n);
  return { ...editor, row: getExpressionRows(editor, n).findIndex(row => row.id === 'fermata') };
};

test('Fermata enters at 2.0, edits tenths within 1.0–4.0, saves/reopens and deletes through note settings', () => {
  const state = fixture(), original = structuredClone(state.project), n = note(state);
  let settings = NoteSettings.open(state.project, state.cursor);
  settings.expression = selectFermata(n);
  const press = (key, shiftKey = false) => NoteSettings.control(state.project, settings,
    { key, shiftKey, repeat: false, isComposing: false, altKey: false, ctrlKey: false, metaKey: false });
  settings = press('Enter').editor;
  assert.deepEqual(fermataFromDraft(settings.expression), { lengthRatio: 2 });
  settings = press('ArrowRight').editor;
  assert.equal(fermataFromDraft(settings.expression).lengthRatio, 2.1);
  for (let i = 0; i < 40; i++) settings = press('ArrowRight').editor;
  assert.equal(fermataFromDraft(settings.expression).lengthRatio, 4);
  for (let i = 0; i < 40; i++) settings = press('ArrowLeft').editor;
  assert.equal(fermataFromDraft(settings.expression).lengthRatio, 1);
  const committed = press('Enter', true).commit;
  const saved = NoteEditor.configure(state.project, state.cursor, committed);
  assert.deepEqual(NoteSettings.open(saved, state.cursor).expression.draft.fermata, { lengthRatio: 1 });
  assert.deepEqual(state.project, original);
  const parent = selectFermata(Timeline.note(saved.outline, n.id).note);
  const removed = controlExpressionEditor(parent, n, 'Delete');
  assert.equal(fermataFromDraft(removed), undefined);
  const cleared = NoteEditor.configure(saved, state.cursor, { fermata: fermataFromDraft(removed) });
  assert.equal(Timeline.note(cleared.outline, n.id).note.fermata, undefined);
});

test('Fermata allows every supported note value, dots, chords and tuplets and extends playback', () => {
  for (const [type, dots] of [['whole', 0], ['half', 1], ['quarter', 1], ['eighth', 1], ['16th', 1], ['32nd', 0]]) {
    const state = fixture(type, dots), before = Plan.create(state.project, 0);
    const project = NoteEditor.configure(state.project, state.cursor, { fermata: { lengthRatio: 2 } });
    assert.deepEqual(note({ ...state, project }).fermata, { lengthRatio: 2 });
    const after = Plan.create(project, 0);
    assert.ok(Math.abs(after.events[0].durationSeconds - before.events[0].durationSeconds * 2) < 1e-9);
    assert.ok(Math.abs(after.durationSeconds - before.durationSeconds - before.events[0].durationSeconds) < 1e-9);
    Integrity.validate(project);
  }
  const state = fixture();
  const chord = NoteEditor.addPitch(state.project, state.cursor);
  const project = NoteEditor.configure(chord.project, chord.cursor, { fermata: { lengthRatio: 2 } });
  const xml = Preview.create(project.outline, 0).xml;
  assert.equal((xml.match(/<fermata type="upright"\/>/g) ?? []).length, 1);
  assert.ok(!xml.includes('lengthRatio'));
  const group = NoteEditor.convertTuplet(state.project, state.cursor);
  const grouped = NoteEditor.configure(group.project, group.cursor, { fermata: { lengthRatio: 2 } });
  assert.deepEqual(note({ ...group, project: grouped }).fermata, { lengthRatio: 2 });
  Integrity.validate(grouped);
});

test('only the tie tail is available; outgoing tie creation is blocked and duration changes remove fermatas', () => {
  const first = fixture(), tail = NoteEditor.appendTie(first.project, first.cursor);
  const head = Timeline.note(tail.project.outline, first.cursor.focusedNoteId).note;
  const middle = selectFermata(head);
  assert.equal(getExpressionRows(middle, head)[middle.row].disabled, true);
  assert.equal(controlExpressionEditor(middle, head, 'Enter'), middle);
  assert.ok(validateExpressionDraft({ detail: null, row: 0, draft: { fermata: { lengthRatio: 2 } } }, head));
  assert.equal(NoteEditor.configure(tail.project, first.cursor, { fermata: { lengthRatio: 2 } }), tail.project);
  const project = NoteEditor.configure(tail.project, tail.cursor, { fermata: { lengthRatio: 2.5 } });
  assert.deepEqual(note({ ...tail, project }).fermata, { lengthRatio: 2.5 });
  assert.equal(NoteEditor.appendTie(project, tail.cursor), undefined);
  const extended = NoteEditor.resizeTie(project, tail.cursor, 1);
  const chain = Timeline.tieChain(extended.project.outline, extended.cursor.focusedNoteId);
  assert.equal(chain.at(-1).note.fermata, undefined);
  assert.ok(chain.slice(0, -1).every(entry => !entry.note.fermata));
  Integrity.validate(extended.project);
});

test('save/reload, passage copy/paste and independent duplication preserve fermata settings', () => {
  const state = fixture();
  const project = NoteEditor.configure(state.project, state.cursor, { fermata: { lengthRatio: 3 } });
  const loaded = JSON.parse(JSON.stringify(project));
  assert.equal(Validator.isValid(loaded), true);
  const copied = NoteEditor.copyPassage(loaded, state.cursor);
  const pasted = NoteEditor.pastePassage(loaded, { ...state.cursor, positionSixteenths: 16 }, copied);
  assert.equal(pasted.ok, true);
  assert.deepEqual(note(pasted).fermata, { lengthRatio: 3 });
  assert.notEqual(note(pasted).fermata, note({ ...state, project: loaded }).fermata);
  const duplicate = NoteEditor.duplicate(loaded, state.cursor);
  assert.deepEqual(note(duplicate).fermata, { lengthRatio: 3 });
  assert.notEqual(note(duplicate).fermata, note({ ...state, project: loaded }).fermata);
});

test('MCP sets/updates/reads/removes fermata while retaining other expressions, and exports its contract', () => {
  const state = fixture(), id = state.cursor.focusedNoteId;
  let project = edit(state.project, [{ type: 'set_note_expression', noteId: id,
    fermata: { lengthRatio: 2 }, accent: { velocityOffset: 18 } }]);
  project = edit(project, [{ type: 'set_note_expression', noteId: id, fermata: { lengthRatio: 4 } }]);
  const elements = Reader.range(project, { firstMeasure: 1, measureCount: 1 }).measures[0].staves[0].voices[0].elements;
  assert.equal(elements.find(element => element.id === id).fermata.lengthRatio, 4);
  assert.equal(elements.find(element => element.id === id).accent.velocityOffset, 18);
  assert.ok(Reader.capabilities('set_note_expression').operationSchema.properties.fermata);
  project = edit(project, [{ type: 'set_note_expression', noteId: id, fermata: null }]);
  assert.equal(note({ ...state, project }).fermata, undefined);
  assert.equal(note({ ...state, project }).accent.velocityOffset, 18);
});

test('invalid ratios and unsupported MCP targets are rejected atomically', () => {
  const state = fixture(), id = state.cursor.focusedNoteId, before = structuredClone(state.project);
  for (const lengthRatio of [0.9, 4.1, 2.05, NaN, Infinity, '2', undefined]) {
    assert.equal(Fermata.validate({ lengthRatio }), false);
    assert.equal(NoteEditor.configure(state.project, state.cursor, { fermata: { lengthRatio } }), state.project);
    assert.throws(() => edit(state.project, [{ type: 'set_note_expression', noteId: id, fermata: { lengthRatio } }]));
    const badSave = structuredClone(state.project);
    Timeline.note(badSave.outline, id).note.fermata = { lengthRatio };
    assert.equal(Validator.isValid(badSave), false);
  }
  const tail = NoteEditor.appendTie(state.project, state.cursor);
  assert.throws(() => edit(tail.project, [{ type: 'set_note_expression', noteId: id, fermata: { lengthRatio: 2 } }]));
  const restId = tail.project.outline.find(block => block.type === 'measure').data.lowerStaff.voices[0].elements[0].id;
  assert.throws(() => edit(tail.project, [{ type: 'set_note_expression', noteId: restId, fermata: { lengthRatio: 2 } }]));
  const graced = NoteEditor.addGrace(state.project, state.cursor);
  const graceId = note(graced).beforeGraceNotes[0].id;
  assert.throws(() => edit(graced.project, [{ type: 'set_note_expression', noteId: graceId, fermata: { lengthRatio: 2 } }]));
  const marked = edit(state.project, [{ type: 'set_note_expression', noteId: id, fermata: { lengthRatio: 2 } }]);
  const continued = NoteEditor.duplicate(marked, state.cursor);
  // A tie cannot leave an existing fermata in the middle. It can be removed in the same MCP batch.
  assert.throws(() => edit(continued.project, [{ type: 'set_tie', fromNoteId: id, toNoteId: continued.cursor.focusedNoteId }]));
  const connected = edit(continued.project, [
    { type: 'set_tie', fromNoteId: id, toNoteId: continued.cursor.focusedNoteId },
    { type: 'set_note_expression', noteId: id, fermata: null },
  ]);
  assert.equal(Timeline.note(connected.outline, id).note.fermata, undefined);
  assert.deepEqual(state.project, before);
});
