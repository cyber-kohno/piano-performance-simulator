import assert from 'node:assert/strict';
import { test } from 'node:test';
import Authoring from '../src/action/editor/score-authoring.ts';
import Editing from '../src/action/editor/score-editing.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import Factory from '../src/domain/score/score-project.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Dynamics from '../src/domain/score/score-dynamics.ts';
import Integrity from '../src/domain/score/score-integrity.ts';
import Validator from '../src/domain/score/score-project-validator.ts';
import NoteSettings from '../src/state/note-settings.ts';
import { createChangesEditor, controlChangesEditor } from '../src/state/changes-editor.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import Preview from '../src/infra/musicxml/preview-musicxml.ts';
import Plan from '../src/domain/performance/score-playback-plan.ts';
import Reader from '../src/service/mcp/mcp-score-reader.ts';

function fixture() {
  return Authoring.apply(Factory.create(), Authoring.createState(), [{ type: 'create_score',
    settings: { meter: [4, 4], keyFifths: 0, tempo: 120 }, measures: [
      { upper: [[{ value: '4', pitches: ['C4'] }, { value: '4', pitches: ['D4'] }, { value: '2', rest: true }]],
        lower: [[{ value: '1', pitches: ['C3'] }]] }, {}, {}, {},
    ] }]).project;
}
const notes = p => Timeline.notes(p.outline);
const cursor = (p, id, staff = 'upperStaff', voiceIndex = 0) => {
  const entry = Timeline.note(p.outline, id, staff);
  return { ...createTimelineCursor(), staff, voiceIndex, focusedNoteId: id, focusedPitchIndex: 0,
    positionSixteenths: entry.measureStartSixteenths + entry.positionSixteenths };
};
const edit = (p, operations) => Editing.apply(p, Authoring.createState(), operations);
const press = (p, editor, key, shiftKey = false) => NoteSettings.control(p, editor,
  { key, shiftKey, repeat: false, isComposing: false, altKey: false, ctrlKey: false, metaKey: false });
const preview = (p, index = 0) => Preview.create(p.outline, index, p.trills, p.tempoChanges, p.clefChanges, p.slurs, p.dynamicChanges).xml;

test('Changes Dynamics uses inherited mf/levels, clamps eight choices and applies atomically with cancel/removal', () => {
  const p = fixture(), [a, b] = notes(p), c = cursor(p, b.note.id), original = structuredClone(p);
  let editor = NoteSettings.open(p, c);
  assert.equal(editor.changes.dynamic, null); assert.equal(editor.changes.currentDynamic, 'mf');
  editor = press(p, editor, 'Tab').editor;
  editor = press(p, editor, 'ArrowDown').editor; editor = press(p, editor, 'ArrowDown').editor;
  editor = press(p, editor, 'Enter').editor;
  assert.equal(editor.changes.detail, 'dynamic'); assert.equal(editor.changes.dynamic, 'mf');
  for (let i = 0; i < 20; i++) editor = press(p, editor, 'ArrowLeft').editor;
  assert.equal(editor.changes.dynamic, 'ppp');
  for (const level of Dynamics.levels.slice(1)) { editor = press(p, editor, 'ArrowRight').editor; assert.equal(editor.changes.dynamic, level); }
  editor = press(p, editor, 'ArrowRight').editor; assert.equal(editor.changes.dynamic, 'fff');
  assert.deepEqual(press(p, editor, 'Escape'), { editor: null }); assert.deepEqual(p, original);
  const saved = NoteEditor.configure(p, c, press(p, editor, 'Enter', true).commit);
  assert.equal(NoteSettings.open(saved, c).changes.dynamic, 'fff');
  const inherited = Dynamics.set(saved, a.note.id, 'p');
  assert.equal(Dynamics.at(inherited, 0), 'p'); assert.equal(Dynamics.at(inherited, 4), 'fff');
  editor = NoteSettings.open(inherited, c); editor.tab = 'changes'; editor.changes.row = 2;
  editor = press(inherited, editor, 'Delete').editor;
  const removed = NoteEditor.configure(inherited, c, press(inherited, editor, 'Enter', true).commit);
  assert.equal(Dynamics.at(removed, 4), 'p');
  const draft = createChangesEditor(undefined, 120, undefined, 'treble', undefined, 'pp');
  assert.equal(controlChangesEditor({ ...draft, row: 2 }, 'Enter', true, true).dynamic, 'pp');
});

test('upper voice 1 only; rests/graces are excluded and tie continuation, short/dotted/tuplet notes are allowed', () => {
  const p = fixture(), [a, b] = notes(p);
  a.note.tieTo = b.note.id; b.note.tieFrom = a.note.id; b.note.pitches = structuredClone(a.note.pitches);
  for (const entry of [a, b]) assert.equal(Dynamics.set(p, entry.note.id, 'f').dynamicChanges[0].level, 'f');
  const low = Timeline.notes(p.outline, 'lowerStaff')[0];
  assert.equal(Dynamics.set(p, low.note.id, 'p'), p);
  const editor = { ...createChangesEditor(undefined, 120, undefined, 'bass'), row: 2 };
  assert.equal(controlChangesEditor(editor, 'Enter', false, true, false), editor);
  assert.equal(NoteEditor.configure(p, cursor(p, low.note.id, 'lowerStaff'), { dynamic: { level: 'p' } }), p);
  const voiced = NoteEditor.addVoice(p, cursor(p, a.note.id));
  const voice2 = NoteEditor.add(voiced, { ...createTimelineCursor(), voiceIndex: 1, pitch: 76 }, 0, 76);
  assert.equal(Dynamics.set(voice2.project, voice2.cursor.focusedNoteId, 'f'), voice2.project);
  const grace = NoteEditor.addGrace(p, cursor(p, a.note.id));
  assert.equal(Dynamics.set(grace.project, Timeline.note(grace.project.outline, a.note.id).note.beforeGraceNotes[0].id, 'f'), grace.project);
  const graceEditor = NoteSettings.open(grace.project, grace.cursor); graceEditor.tab = 'changes'; graceEditor.changes.row = 2;
  assert.equal(press(grace.project, graceEditor, 'Enter').editor.changes.dynamic, null);
  assert.equal(NoteEditor.configure(grace.project, grace.cursor, { dynamic: { level: 'f' } }), grace.project);
  const rest = p.outline[2].data.upperStaff.voices[0].elements.at(-1);
  assert.equal(Dynamics.set(p, rest.id, 'f'), p);
  const fresh = fixture(), single = notes(fresh)[0];
  const dotted = NoteEditor.setValue(fresh, cursor(fresh, single.note.id), { type: 'eighth', dots: 1 });
  assert.equal(Dynamics.set(dotted.project, single.note.id, 'mp').dynamicChanges[0].level, 'mp');
  const group = NoteEditor.convertTuplet(fresh, cursor(fresh, single.note.id));
  assert.equal(Dynamics.set(group.project, single.note.id, 'pp').dynamicChanges[0].level, 'pp');
  const short = NoteEditor.setValue(fresh, cursor(fresh, single.note.id), { type: '32nd', dots: 0 });
  assert.equal(Dynamics.set(short.project, single.note.id, 'ppp').dynamicChanges[0].level, 'ppp');
});

test('dynamic changes follow edits, survive tie normalization and are removed on deletion without being duplicated', () => {
  const p = fixture(), [a, b] = notes(p);
  let saved = Dynamics.set(p, a.note.id, 'p'); saved = Dynamics.set(saved, b.note.id, 'f');
  const moved = NoteEditor.move(saved, cursor(saved, b.note.id), 1).project;
  assert.equal(Dynamics.changes(moved).find(change => change.noteId === b.note.id).position, 5);
  const pitched = NoteEditor.movePitch(saved, cursor(saved, b.note.id), 1).project;
  assert.equal(Dynamics.at(pitched, 4), 'f');
  const chord = NoteEditor.addPitch(saved, cursor(saved, b.note.id)).project;
  assert.equal(Dynamics.at(chord, 4), 'f');
  const resized = NoteEditor.setValue(saved, cursor(saved, b.note.id), { type: 'eighth', dots: 0 }).project;
  assert.equal(Dynamics.at(resized, 4), 'f');
  const duplicated = NoteEditor.duplicate(saved, cursor(saved, b.note.id)).project;
  assert.deepEqual(duplicated.dynamicChanges, saved.dynamicChanges);
  const passage = NoteEditor.copyPassage(saved, cursor(saved, b.note.id));
  const pasted = NoteEditor.pastePassage(saved, { ...createTimelineCursor(), positionSixteenths: 16 }, passage);
  assert.equal(pasted.ok, true); assert.deepEqual(pasted.project.dynamicChanges, saved.dynamicChanges);
  const deleted = NoteEditor.remove(saved, cursor(saved, b.note.id)).project;
  assert.equal(Dynamics.at(deleted, 4), 'p');
  // A change in the middle of a tie must remain an explicit boundary.
  a.note.tieTo = b.note.id; b.note.tieFrom = a.note.id; b.note.pitches = structuredClone(a.note.pitches);
  const tied = Dynamics.set(p, b.note.id, 'ff');
  const normalized = NoteEditor.normalizeTie(tied, cursor(tied, b.note.id)).project;
  assert.equal(Dynamics.changes(normalized)[0].position, 4);
  assert.equal(Dynamics.at(normalized, 4), 'ff');
});

test('MusicXML emits one direction at the exact note offset with no playback sound or note/clef rewrite', () => {
  const p = fixture(), b = notes(p)[1], baseline = preview(p);
  const saved = Dynamics.set(p, b.note.id, 'mf'), xml = preview(saved);
  assert.match(xml, /<direction placement="below"><direction-type><dynamics><mf\/><\/dynamics><\/direction-type><offset>8<\/offset><staff>1<\/staff><\/direction>/);
  assert.equal((xml.match(/<dynamics>/g) ?? []).length, 1); assert.ok(!xml.includes('<sound dynamics='));
  assert.deepEqual(xml.match(/<note>[\s\S]*?<\/note>/g), baseline.match(/<note>[\s\S]*?<\/note>/g));
  assert.deepEqual(xml.match(/<clef[\s\S]*?<\/clef>/g), baseline.match(/<clef[\s\S]*?<\/clef>/g));
  assert.ok(!preview(saved, 3).includes('<dynamics>'), 'clipped previews do not invent new marks');
  for (const level of Dynamics.levels) assert.ok(preview(Dynamics.set(p, b.note.id, level)).includes(`<${level}/>`));
});

test('MCP sets, reads inherited state, removes and automatically cleans deleted/rested anchors atomically', () => {
  const p = fixture(), [a, b] = notes(p);
  let saved = edit(p, [{ type: 'set_dynamic_change', noteId: a.note.id, level: 'p' },
    { type: 'set_dynamic_change', noteId: b.note.id, level: 'ff' }]).project;
  assert.equal(Reader.overview(saved).expressionCounts.dynamicChanges, 2);
  assert.equal(Reader.range(saved, { firstMeasure: 2, measureCount: 1 }).measures[0].dynamicAtStart, 'ff');
  assert.equal(Reader.range(saved, { firstMeasure: 1, measureCount: 1 }).dynamicChanges.length, 2);
  const lowerOnly = Reader.range(saved, { firstMeasure: 1, measureCount: 1, staff: 'lowerStaff' });
  assert.equal(lowerOnly.dynamicChanges.length, 2);
  assert.ok(lowerOnly.externalAnchors.some(anchor => anchor.noteId === b.note.id && anchor.staff === 'upperStaff'));
  assert.ok(Reader.capabilities('set_dynamic_change').operationSchema.properties.level);
  const rested = edit(saved, [{ type: 'set_rest', noteId: b.note.id }]);
  assert.equal(Dynamics.at(rested.project, 4), 'p');
  assert.ok(rested.summary.removedAnchors.some(anchor => anchor.kind === 'dynamicChanges' && anchor.noteId === b.note.id));
  saved = edit(saved, [{ type: 'set_dynamic_change', noteId: b.note.id, level: null }]).project;
  assert.equal(Dynamics.at(saved, 8), 'p');
  const baseline = structuredClone(saved), low = Timeline.notes(saved.outline, 'lowerStaff')[0];
  for (const operation of [
    { type: 'set_dynamic_change', noteId: low.note.id, level: 'f' },
    { type: 'set_dynamic_change', noteId: a.note.id, level: 'sfz' },
    { type: 'set_dynamic_change', noteId: 'missing', level: 'f' },
  ]) assert.throws(() => edit(saved, [operation]));
  assert.deepEqual(saved, baseline);
});

test('saved dynamics retain notation/state and coexist with expressions while preview playback stays unchanged', () => {
  const p = fixture(), a = notes(p)[0];
  const saved = NoteEditor.configure(p, cursor(p, a.note.id), {
    dynamic: { level: 'ppp' }, accent: { velocityRate: 1.5 }, staccato: { type: 'normal', lengthRatio: 0.5 }, fermata: { lengthRatio: 2 },
  });
  assert.equal(Dynamics.at(saved, 0), 'ppp'); Integrity.validate(saved);
  const without = { ...saved, dynamicChanges: [] };
  assert.deepEqual(Plan.create(saved, 0), Plan.create(without, 0));
  const restored = JSON.parse(JSON.stringify(saved));
  assert.equal(Validator.isValid(restored), true); assert.equal(Dynamics.isValid(restored), true);
  assert.deepEqual(restored.dynamicChanges, saved.dynamicChanges);
  const malformed = { ...saved, dynamicChanges: [{ noteId: a.note.id, level: '<bad/>' }] };
  assert.equal(Validator.isValid(malformed), false);
  const duplicate = { ...saved, dynamicChanges: [...saved.dynamicChanges, ...saved.dynamicChanges] };
  assert.equal(Dynamics.isValid(duplicate), false); assert.throws(() => Integrity.validate(duplicate));
  const missing = { ...saved, dynamicChanges: [{ noteId: 'missing', level: 'f' }] };
  assert.equal(Dynamics.isValid(missing), false);
});
