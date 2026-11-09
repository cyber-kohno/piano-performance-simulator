import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ScoreAuthoring from '../src/action/editor/score-authoring.ts';
import Input from '../src/domain/score/score-authoring-input.ts';
import Factory from '../src/domain/score/score-project.ts';
import Controller from '../src/service/mcp/mcp-editor-controller.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import Preview from '../src/infra/musicxml/preview-musicxml.ts';

const example = JSON.parse(readFileSync(new URL('../../../../docs/plan/mcp/score-authoring-example.json', import.meta.url)));
const operation = () => structuredClone(example.operations[0]);
const build = operations => ScoreAuthoring.apply(Factory.create(), ScoreAuthoring.createState(), operations);
function normalize(project) {
  const ids = new Map();
  const collect = item => {
    if (!item || typeof item !== 'object') return;
    if (item.id && !item.id.startsWith('voice-')) ids.set(item.id, `id-${ids.size}`);
    Object.values(item).forEach(collect);
  };
  collect(project);
  return JSON.parse(JSON.stringify(project, (key, value) => ['id', 'tieFrom', 'tieTo'].includes(key) ? ids.get(value) ?? value : value));
}
function fixture() {
  let live = Factory.create();
  const writes = [], states = [];
  const controller = Controller.create({ getEditorState: project => ({ project }), checkoutBlocker: () => null,
    getEditContext: () => ({ project: live, timelineCursor: createTimelineCursor() }),
    updateProject: (previous, next, focus) => { assert.equal(previous, live); live = next; writes.push({ next, focus }); },
    checkoutChanged: state => states.push(state) });
  const call = (method, params = {}) => controller.handle({ id: 'test', method, params: { ownerId: 'agent', ...params } });
  const checkoutId = call('beginCheckout').result.checkoutId;
  const revisions = new Map();
  const apply = (requestId, operations) => {
    if (!revisions.has(requestId)) revisions.set(requestId, call('getEditorState', { checkoutId }).result.revision);
    return call('applyEdit', { checkoutId, requestId, expectedRevision: revisions.get(requestId), operations });
  };
  const draft = () => call('getEditorState', { checkoutId }).result.project;
  return { controller, call, apply, draft, checkoutId, writes, states, live: () => live };
}

test('eight-measure one-shot and split construction have the same notes, voices, rests and tie graph', () => {
  const op = operation();
  const complete = build([op]);
  const first = build([{ ...op, measures: op.measures.slice(0, 4) }]);
  assert.equal(first.summary.unresolvedTies, 1);
  assert.throws(() => ScoreAuthoring.validate(first.project, first.state, true), /resolve pending ties/);
  const second = ScoreAuthoring.apply(first.project, first.state, [{ type: 'append_measures', measures: op.measures.slice(4) }]);
  assert.deepEqual(normalize(second.project), normalize(complete.project));
  assert.equal(second.summary.firstMeasure, 5);
  assert.equal(second.summary.lastMeasure, 8);
  ScoreAuthoring.validate(second.project, second.state, true);
  // Exercise MusicXML conversion for every visible window, including tuplets and ties.
  for (let i = 0; i < 8; i++) assert.ok(Preview.create(second.project.outline, i));
  assert.deepEqual(Factory.create().outline.length, 2);
});

test('failed batch is atomic and a failed request ID can be corrected and reused', () => {
  const f = fixture(), op = operation();
  const invalid = { type: 'append_measures', measures: [{ upper: [[{ value: '4', pitches: ['C5'] }]] }] };
  const before = structuredClone(f.draft());
  const error = f.apply('fixable', [op, invalid]).error;
  assert.equal(error.code, 'INVALID_SCORE_INPUT');
  assert.match(error.message, /operations\[1\]\.measures\[0\]\.upper\[0\]/);
  assert.deepEqual(f.draft(), before);
  assert.equal(f.apply('fixable', [op]).result.addedMeasures, 8);
  const successful = structuredClone(f.draft());
  assert.ok(f.apply('later-invalid', [invalid]).error);
  assert.deepEqual(f.draft(), successful);
  assert.equal(f.writes.length, 0);
});

test('retry returns its original result without appending again; reordered JSON keys are equivalent', () => {
  const f = fixture(), op = operation();
  const original = f.apply('retry', [op]);
  const reorder = { measures: op.measures, settings: op.settings, type: op.type };
  assert.deepEqual(f.apply('retry', [reorder]), original);
  assert.equal(f.draft().outline.length, 10);
  op.measures.pop();
  assert.equal(f.apply('retry', [op]).error.code, 'REQUEST_ID_CONFLICT');
});

test('unfinished ties block finish, preserve checkout, and can be resolved before a single commit', () => {
  const f = fixture(), op = operation();
  f.apply('first', [{ ...op, measures: op.measures.slice(0, 4) }]);
  assert.equal(f.call('finishCheckout', { checkoutId: f.checkoutId }).error.code, 'UNRESOLVED_TIES');
  assert.equal(f.writes.length, 0);
  const before = structuredClone(f.draft());
  assert.equal(f.apply('bad-tie', [{ type: 'append_measures', measures: [{}] }]).error.code, 'INVALID_TIE');
  assert.deepEqual(f.draft(), before);
  f.apply('last', [{ type: 'append_measures', measures: op.measures.slice(4) }]);
  assert.equal(f.call('finishCheckout', { checkoutId: f.checkoutId }).result.changed, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].focus, true);
  assert.equal(f.states.at(-1).active, false);
});

test('forced stop discards construction, retry cache and pending ties; old requests remain invalid', () => {
  const f = fixture(), op = operation();
  f.apply('first', [{ ...op, measures: op.measures.slice(0, 4) }]);
  f.controller.releaseCheckout();
  assert.equal(f.live().outline.length, 2);
  const fresh = f.call('beginCheckout').result.checkoutId;
  assert.notEqual(fresh, f.checkoutId);
  assert.equal(f.apply('first', [op]).error.code, 'CHECKOUT_REQUIRED');
  assert.equal(f.call('applyEdit', { checkoutId: fresh, expectedRevision: f.call('getEditorState', { checkoutId: fresh }).result.revision, requestId: 'first', operations: [op] }).result.addedMeasures, 8);
});

test('rejects overfull voices, empty arrays, unsupported fields, malformed tuplets and unrepresentable spellings', () => {
  const cases = [
    { upper: [] }, { upper: [[]] },
    { upper: [[{ value: '1', pitches: ['C5'] }, { value: '4', pitches: ['D5'] }]] },
    { upper: [[{ value: '1', pitches: ['C5'], slur: true }]] },
    { upper: [[{ value: '1', pitches: ['C5', 'C5'] }]] },
    { upper: [[{ tuplet: { actual: 3, normal: 2, base: '8', events: [{ value: '8', pitches: ['C5'] }] } }]] },
    { upper: [[{ value: '1', pitches: ['Cbb4'] }]] },
    { upper: [[{ value: '1', pitches: ['C9'] }]] },
  ];
  for (const measure of cases) assert.throws(() => build([{ ...operation(), measures: [measure] }]));
  assert.equal(Input.pitch('C4', { fifths: 0 }, 'pitch').midi, 60);
  assert.equal(Input.pitch('Bb3', { fifths: 0 }, 'pitch').midi, 58);
});

test('requires empty project and authoring ownership; enforces request limits and final reference validation', () => {
  const whole = build([operation()]);
  assert.throws(() => ScoreAuthoring.apply(whole.project, ScoreAuthoring.createState(), [operation()]), /empty project/);
  assert.equal(build([{ type: 'append_measures', measures: [{}] }]).summary.addedMeasures, 1);
  assert.throws(() => build([{ ...operation(), measures: Array.from({ length: 33 }, () => ({})) }]), /32/);
  const firstNote = whole.project.outline[2].data.upperStaff.voices[0].elements[0];
  firstNote.tieTo = 'missing';
  assert.throws(() => ScoreAuthoring.validate(whole.project, whole.state, true), /Invalid tie/);
  const f = fixture();
  assert.equal(f.apply('too-large', [{ ...operation(), unused: 'x'.repeat(50 * 1024) }]).error.code, 'REQUEST_LIMIT');
});

test('ties use exact time across tuplet children, the following ordinary note and a measure boundary', () => {
  const op = operation();
  op.measures = [
    { upper: [[{ tuplet: { actual: 3, normal: 2, base: '8', events: Array.from({ length: 3 }, () =>
      ({ value: '8', pitches: ['C5'], tie: true })) } }, { value: '2.', pitches: ['C5'], tie: true }]] },
    { upper: [[{ value: '1', pitches: ['C5'] }]] },
  ];
  const result = build([op]);
  ScoreAuthoring.validate(result.project, result.state, true);
  const group = result.project.outline[2].data.upperStaff.voices[0].elements[0];
  assert.equal(group.elements[0].tieTo, group.elements[1].id);
  assert.equal(group.elements[1].tieTo, group.elements[2].id);
  assert.ok(Preview.create(result.project.outline, 0));
});
