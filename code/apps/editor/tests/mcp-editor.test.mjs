import test from 'node:test';
import assert from 'node:assert/strict';
import McpEditorController from '../src/service/mcp/mcp-editor-controller.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';

function fixture() {
  let project = ScoreProjectFactory.create();
  const data = ScoreMeasure.create({ unit: 4, cnt: 4 });
  data.upperStaff.voices[0].elements = [{ kind: 'note', id: 'a', value: { type: 'whole', dots: 0 }, pitches: [{ midi: 60 }] }];
  project.outline.push({ id: 'm', type: 'measure', data });
  const baseline = structuredClone(project), writes = [], states = [];
  let blocker = null;
  const controller = McpEditorController.create({
    getEditorState: project => ({ project }),
    checkoutBlocker: () => blocker,
    getEditContext: () => ({ project, timelineCursor: createTimelineCursor() }),
    updateProject: (previous, next) => { assert.equal(previous, project); project = next; writes.push(next); },
    checkoutChanged: state => states.push({ ...state, writes: writes.length }),
  });
  const request = (method, params = {}) => controller.handle({ id: 'request', method, params: { ownerId: 'agent', ...params } });
  const begin = () => request('beginCheckout').result.checkoutId;
  const edit = (checkoutId, extra = {}) => request('applyEdit', { checkoutId, operation: 'set_pitch_fingering', noteId: 'a', staff: 'upperStaff', pitchIndex: 0, fingering: 2, ...extra });
  return { controller, request, begin, edit, writes, states, baseline, project: () => project,
    block: reason => blocker = reason, externalChange: () => project = { ...project } };
}
const fingering = project => ScoreTimeline.note(project.outline, 'a').note.pitches[0].fingering;

test('stages edits, reads the candidate, and commits once before unlocking and notifying', () => {
  const f = fixture(), id = f.begin();
  assert.equal(f.begin(), id);
  assert.equal(f.edit(id).result.changed, true);
  assert.equal(f.edit(id, { fingering: 4 }).result.changed, true);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.project(), f.baseline);
  assert.equal(fingering(f.request('getEditorState', { checkoutId: id }).result.project), 4);
  assert.equal(f.request('finishCheckout', { checkoutId: id }).result.changed, true);
  assert.equal(f.writes.length, 1);
  assert.equal(fingering(f.project()), 4);
  assert.deepEqual(f.states.at(-1), { active: false, completed: true, writes: 1 });
  assert.equal(f.edit(id).error.code, 'CHECKOUT_REQUIRED');
  assert.equal(f.request('finishCheckout', { checkoutId: id }).error.code, 'CHECKOUT_REQUIRED');
});

test('forced stop discards edits and rejects delayed requests even after the same agent restarts', () => {
  const f = fixture(), old = f.begin();
  f.edit(old);
  f.controller.releaseCheckout();
  assert.deepEqual(f.project(), f.baseline);
  assert.equal(f.writes.length, 0);
  assert.equal(f.states.at(-1).active, false);
  const fresh = f.begin();
  assert.notEqual(fresh, old);
  for (const method of ['applyEdit', 'getEditorState', 'finishCheckout']) {
    assert.equal(f.request(method, { checkoutId: old }).error.code, 'CHECKOUT_REQUIRED');
  }
  assert.equal(f.request('finishCheckout', { checkoutId: fresh }).result.changed, false);
  assert.equal(f.writes.length, 0);
});

test('rejects pending UI work without acquiring a checkout and protects against other owners', () => {
  const f = fixture();
  for (const reason of ['Pending text input', 'Pending note settings', 'Dialog open', 'File operation', 'Playback']) {
    f.block(reason);
    const response = f.request('beginCheckout');
    assert.equal(response.error.code, 'EDITOR_BUSY');
    assert.equal(response.error.message, reason);
    assert.equal(f.states.length, 0);
  }
  f.block(null);
  const id = f.begin();
  assert.equal(f.request('beginCheckout', { ownerId: 'other' }).error.code, 'CHECKOUT_BUSY');
  assert.equal(f.request('finishCheckout', { ownerId: 'other', checkoutId: id }).error.code, 'CHECKOUT_REQUIRED');
  assert.equal(f.request('getEditorState').error.code, 'CHECKOUT_REQUIRED');
});

test('invalid edits leave the candidate unchanged; changed live projects cannot be overwritten', () => {
  const f = fixture(), id = f.begin();
  assert.equal(f.edit(id, { fingering: 6 }).error.code, 'INVALID_ARGUMENT');
  assert.equal(f.edit(id, { substitutionFingering: 2 }).error.code, 'INVALID_ARGUMENT');
  assert.equal(f.edit(id, { pitchIndex: 2 }).error.code, 'TARGET_NOT_FOUND');
  assert.deepEqual(f.request('getEditorState', { checkoutId: id }).result.project, f.baseline);
  f.edit(id);
  f.externalChange();
  assert.equal(f.request('finishCheckout', { checkoutId: id }).error.code, 'PROJECT_CHANGED');
  assert.equal(f.writes.length, 0);
  f.controller.releaseCheckout();
  assert.equal(fingering(f.project()), undefined);
});
