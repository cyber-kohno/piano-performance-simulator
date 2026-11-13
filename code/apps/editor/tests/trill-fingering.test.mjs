import assert from 'node:assert/strict';
import { test } from 'node:test';
import Factory from '../src/domain/score/score-project.ts';
import Measure from '../src/domain/score/score-measure.ts';
import Trill from '../src/domain/score/score-trill.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Integrity from '../src/domain/score/score-integrity.ts';
import Validator from '../src/domain/score/score-project-validator.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import NotePitches from '../src/domain/score/note-pitches.ts';
import FingeringInput from '../src/state/fingering-input.ts';
import FloatingText from '../src/state/floating-text-input.ts';
import { createExpressionEditor, controlExpressionEditor, trillFromDraft, validateExpressionDraft } from '../src/state/expression-editor.ts';
import Preview from '../src/infra/musicxml/preview-musicxml.ts';
import File from '../src/infra/tauri/project-file.ts';
import History from '../src/service/history/editor-history.ts';
import Editing from '../src/action/editor/score-editing.ts';
import Authoring from '../src/action/editor/score-authoring.ts';
import Reader from '../src/service/mcp/mcp-score-reader.ts';
import Contract from '../src/domain/score/score-edit-contract.ts';
import ScoreFingerings from '../src/domain/score/score-fingerings.ts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const fingers = [2, 3, 2, 3, 2, 3, 2];
const settings = { ...Trill.defaults, attackCount: 7, fingerings: fingers };
function fixture(count = 2) {
  const p = Factory.create();
  for (let i = 0; i < count; i++) {
    const data = Measure.create({ cnt: 4, unit: 4 });
    data.upperStaff.voices[0].elements = [{ id: `n${i}`, kind: 'note', value: { type: 'whole', dots: 0 },
      pitches: [{ midi: 72, fingering: 2, substitutionFingering: 3 }],
      ...(i ? { tieFrom: `n${i - 1}` } : {}), ...(i + 1 < count ? { tieTo: `n${i + 1}` } : {}) }];
    p.outline.push({ id: `m${i}`, type: 'measure', data });
  }
  return p;
}

test('trill input accepts exactly one 1–5 digit per attack, repeated fingers and empty removal, without substitutions', () => {
  assert.deepEqual(FingeringInput.parseTrill('2323232', 7), fingers);
  assert.equal(FingeringInput.parseTrill('', 7), null);
  for (const text of ['232323', '23232323', '2-32323', '2323230', '2323236', '23 3232', 'abcdefg'])
    assert.equal(FingeringInput.parseTrill(text, 7), undefined, text);
  let input = FloatingText.create('');
  for (const key of '232323223') input = FloatingText.control(input, { key }, 7).state;
  assert.equal(input.value, '2323232');
  assert.equal(FingeringInput.parseTrill('2'.repeat(128), 128).length, 128);
});

test('one optional sequence belongs to the whole tie chain and clears ordinary fingerings without mutating snapshots', () => {
  const p = fixture(), saved = structuredClone(p), source = [...fingers];
  let next = Trill.set(p, 'n1', { ...settings, fingerings: source });
  assert.deepEqual(p, saved); source[0] = 5;
  assert.deepEqual(Trill.forNote(next, 'n0').settings.fingerings, fingers);
  for (const id of ['n0', 'n1']) {
    assert.equal(Trill.forNote(next, id).id, next.trills[0].id);
    assert.deepEqual(Timeline.note(next.outline, id).note.pitches, [{ midi: 72 }]);
    assert.equal(NotePitches.setFingering(next, { noteId: id, staff: 'upperStaff', pitchIndex: 0 }, 2, 3), next);
  }
  Integrity.validate(next);
  const history = History.create({ project: next });
  const updated = NoteEditor.setTrillFingerings(next, 'n1', [3, 2, 3, 2, 3, 2, 3]);
  history.record({ project: updated });
  assert.deepEqual(history.undo().project.trills[0].settings.fingerings, fingers);
  assert.deepEqual(history.redo().project.trills[0].settings.fingerings, [3, 2, 3, 2, 3, 2, 3]);
  next = NoteEditor.setTrillFingerings(updated, 'n0');
  assert.equal('fingerings' in next.trills[0].settings, false);
  assert.equal(Trill.set(next, 'n1', undefined).trills, undefined);
});

test('save validation accepts optional sequences and rejects bad lengths, digits, strings and substitutions', () => {
  const p = Trill.set(fixture(), 'n1', settings);
  const loaded = File.parse(File.serialize(p));
  assert.ok(Validator.isValid(loaded)); Integrity.validate(loaded);
  assert.deepEqual(loaded, p);
  for (const fingerings of [[], [2], [2, 3, 2, 3, 2, 3, 6], [2, 3, 2, 3, 2, 3, 1.5], '2323232', null, [{ fingering: 2, substitutionFingering: 3 }]]) {
    const bad = { ...settings, fingerings };
    assert.equal(Trill.validate(bad), false);
    assert.equal(Trill.set(p, 'n0', bad), p);
    assert.equal(Validator.isValid({ ...p, trills: [{ ...p.trills[0], settings: bad }] }), false);
  }
  assert.ok(Validator.isValid(Trill.set(p, 'n0', Trill.defaults)));
});

test('expression drafts preserve the sequence for other settings and clear it when the attack count changes', () => {
  const p = Trill.set(fixture(), 'n0', settings), note = Timeline.note(p.outline, 'n1').note;
  let editor = { ...createExpressionEditor(note, settings), detail: 'trill', row: 0 };
  assert.notEqual(editor.draft.trill.fingerings, fingers);
  editor = controlExpressionEditor(editor, note, 'ArrowRight', p);
  assert.deepEqual(trillFromDraft(editor).fingerings, fingers);
  editor = { ...editor, row: 2 };
  editor = controlExpressionEditor(editor, note, 'ArrowRight', p);
  assert.equal(trillFromDraft(editor).attackCount, 8);
  assert.equal('fingerings' in trillFromDraft(editor), false);
  assert.equal(validateExpressionDraft(editor, note, p), undefined);
  assert.deepEqual(settings.fingerings, fingers);
});

test('preview emits the full sequence once on the trill start, including clipped windows, without substitution notation', () => {
  const p = Trill.set(fixture(8), 'n0', settings);
  for (const index of [0, 4]) {
    const xml = Preview.create(p.outline, index, p.trills).xml;
    assert.equal((xml.match(/<fingering>2323232<\/fingering>/g) ?? []).length, 1);
    assert.doesNotMatch(xml, /substitution="yes"/);
    assert.match(xml, /<trill-mark/);
    assert.equal((xml.match(/<fingering>/g) ?? []).length, 1);
  }
});

test('MCP set_trill reads/writes the sequence atomically, forbids scalar fingering and rejects mismatched arrays', () => {
  const p = fixture();
  const apply = (project, operations) => Editing.apply(project, Authoring.createState(), operations).project;
  const op = { type: 'set_trill', noteId: 'n1', settings };
  Contract.validate([op]);
  const updated = apply(p, [op]);
  assert.deepEqual(Reader.range(updated, { firstMeasure: 1, measureCount: 2 }).trills[0].settings.fingerings, fingers);
  for (const fingerings of [[2, 3], [2, 3, 2, 3, 2, 3, 0]])
    assert.throws(() => apply(updated, [{ ...op, settings: { ...settings, fingerings } }]));
  assert.throws(() => apply(updated, [{ type: 'set_fingering', noteId: 'n1', pitchIndex: 0, fingering: 2, substitutionFingering: 3 }]), /set_trill/);
  const cleared = apply(updated, [{ ...op, settings: { ...Trill.defaults, attackCount: 9 } }]);
  assert.equal(cleared.trills[0].settings.fingerings, undefined);
  assert.deepEqual(updated.trills[0].settings.fingerings, fingers);
});

test('actual App input handlers edit a trill from its tied tail, accept seven digits, cancel invalid input and clear it', () => {
  const source = readFileSync(new URL('../src/App.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('App.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['openFingeringTextInput', 'controlFloatingText', 'commitFingeringText'];
  const handlers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  assert.equal(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).length, 3);
  const js = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const create = new Function('deps', `const {ScoreTimeline,ScoreTrill,ScoreFingerings,FloatingText,FingeringInput,NoteEditor}=deps;
    return function(project) {
      let fingeringTextInput=null, sectionTextInput=null;
      const mode='timeline', pedalMode=false, ottavaMode=false, playback=null, selectedTimelineNotes=[{}];
      const timelineCursor={staff:'upperStaff',voiceIndex:0,focusedNoteId:'n1',focusedPitchIndex:0,positionSixteenths:16};
      const document={querySelectorAll:()=>[{dataset:{fingeringPitch:'n1:0'}}]};
      const keyHold={reset(){}}, uiEditAllowed=()=>true, getFocusedGrace=()=>undefined;
      let writes=0; const recordProjectChange=()=>writes++;
      const commitSectionText=()=>{};
      ${js}
      return {open:openFingeringTextInput,key:key=>controlFloatingText({key,preventDefault(){}}),
        get draft(){return fingeringTextInput},get project(){return project},get writes(){return writes}};
    };` )({ ScoreTimeline:Timeline, ScoreTrill:Trill, ScoreFingerings, FloatingText, FingeringInput, NoteEditor });
  const p = Trill.set(fixture(), 'n0', { ...Trill.defaults, attackCount: 7 }), ui = create(p);
  assert.equal(ui.open(), true);
  for (const key of '2323232') ui.key(key);
  assert.equal(ui.draft.value, '2323232');
  ui.key('Enter'); assert.equal(ui.draft, null); assert.equal(ui.writes, 1);
  assert.deepEqual(ui.project.trills[0].settings.fingerings, fingers);
  ui.open(); assert.equal(ui.draft.value, '2323232');
  for (let i=0;i<7;i++) ui.key('Backspace');
  ui.key('Enter'); assert.equal(ui.project.trills[0].settings.fingerings, undefined);
  ui.open(); for (const key of '2-32323') ui.key(key);
  const before = ui.project;
  ui.key('Enter'); assert.notEqual(ui.draft, null); assert.equal(ui.project, before);
  ui.key('Escape'); assert.equal(ui.draft, null); assert.equal(ui.writes, 2);
});
