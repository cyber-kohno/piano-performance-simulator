// Writes only to an explicitly identified, disposable GUI test session.
// node editing-smoke.mjs <executable> <complete-sessionId> create|revise
import assert from 'node:assert/strict';
import { connect } from './stdio-client.mjs';

const [executable, sessionId, phase] = process.argv.slice(2);
assert.ok(executable && /^[0-9a-f-]{36}$/i.test(sessionId ?? '') && ['create', 'revise'].includes(phase), 'Provide executable, complete sessionId and create|revise');
const client = await connect(executable);
let checkoutId, revision, sequence = 0;
async function raw(name, args = {}) { return client.call('tools/call', { name, arguments: ['ping', 'list_clavierdesk_sessions'].includes(name) ? args : { sessionId, ...args } }); }
async function tool(name, args = {}) {
  const response = await raw(name, args);
  assert.equal(response.isError ?? false, false, JSON.stringify(response));
  return JSON.parse(response.content.find(item => item.type === 'text').text);
}
const note = (pitches, value = '4') => ({ value, pitches: Array.isArray(pitches) ? pitches : [pitches] });
async function batch(operations) {
  const args = { checkoutId, expectedRevision: revision, requestId: `${phase}-${++sequence}`, operations };
  const result = await tool('apply_edit', args);
  assert.deepEqual(await tool('apply_edit', args), result);
  revision = result.revision;
  return { args, result };
}
try {
  const sessions = await tool('list_clavierdesk_sessions');
  assert.ok(sessions.sessions.some(session => session.sessionId === sessionId));
  assert.equal((await tool('probe_session')).sessionId, sessionId);
  const capabilities = await tool('get_capabilities');
  assert.ok(capabilities.operations.includes('set_grace_notes') && capabilities.operations.includes('set_trill'));
  const overview = await tool('get_score_overview');
  assert.equal(overview.measureCount, phase === 'create' ? 0 : 2, 'Use a disposable empty test session for create, or its two-measure result for revise');
  const begin = await tool('begin_checkout'); checkoutId = begin.checkoutId; revision = begin.revision;
  assert.equal(revision, overview.revision);
  if (phase === 'create') {
    await batch([{ type: 'create_score', settings: { meter: [4, 4], keyFifths: 0, tempo: 100 }, measures: [
      { upper: [[note('C5'), note('D5'), note('E5'), note('F5')]], lower: [[note('C3', '1')]] },
      { upper: [[note('C5'), note('D5'), note(['A4', 'C5', 'E5']), note('F5')]], lower: [[note('G2', '1')]] },
    ] }]);
    const range = await tool('get_score_range', { checkoutId, firstMeasure: 1, measureCount: 2 });
    const first = range.measures[0], second = range.measures[1];
    const ids = first.staves[0].voices[0].timeline.map(event => event.id);
    const chord = second.staves[0].voices[0].timeline[2].id;
    const pos = (measureId, numerator) => ({ measureId, offset: { numerator, denominator: 1 } });
    const savedRevision = revision;
    await batch([
      { type: 'set_grace_notes', noteId: ids[0], notes: [{ value: '16', pitch: 'B4', slash: true, fingering: 2 }], performance: { spreadRatio: 0.5, timing: 0 } },
      { type: 'set_trill', noteId: ids[1], settings: { auxiliary: 'whole', start: 'main', attackCount: 8 } },
      { type: 'set_note_expression', noteId: ids[2], staccato: { type: 'normal', lengthRatio: 0.3 } },
      { type: 'set_note_expression', noteId: chord, arpeggio: { type: 'normal', spreadRatio: 0.5, timing: 0 } },
      { type: 'set_slur', startNoteId: ids[0], endNoteId: ids[3] },
      { type: 'set_tempo_change', noteId: ids[0], bpm: 116 },
      { type: 'set_pedal_event', position: pos(first.id, 0), action: 'start' },
      { type: 'set_pedal_event', position: pos(second.id, 3), action: 'stop' },
      { type: 'set_ottava_event', position: pos(first.id, 1), staff: 'upperStaff', action: 'start' },
      { type: 'set_ottava_event', position: pos(second.id, 1), staff: 'upperStaff', action: 'stop' },
    ]);
    const stale = await raw('apply_edit', { checkoutId, expectedRevision: savedRevision, requestId: 'stale-check',
      operations: [{ type: 'set_pitches', noteId: ids[0], pitches: ['C6'] }] });
    assert.equal(stale.isError, true); assert.equal(JSON.parse(stale.content[0].text).code, 'STALE_REVISION');
    const state = await tool('get_score_range', { checkoutId, firstMeasure: 1, measureCount: 2 });
    assert.equal(state.measures[0].staves[0].voices[0].elements[0].beforeGraceNotes.length, 1);
    assert.equal(state.trills.length, 1); assert.equal(state.slurs.length, 1);
  } else {
    const range = await tool('get_score_range', { checkoutId, firstMeasure: 1, measureCount: 2 });
    const firstId = range.measures[0].staves[0].voices[0].timeline[0].id;
    await batch([{ type: 'set_pitches', noteId: firstId, pitches: ['C6'] }, { type: 'append_measures', measures: [
      { upper: [[note('D4', '1')]] },
    ] }]);
    const state = await tool('get_score_range', { checkoutId, firstMeasure: 1, measureCount: 3 });
    assert.equal(state.totalMeasures, 3);
    assert.equal(state.measures[0].staves[0].voices[0].timeline[0].id, firstId);
    assert.equal(state.measures[0].staves[0].voices[0].timeline[0].pitches[0].name, 'C6');
  }
  const committed = await tool('finish_checkout', { checkoutId }); checkoutId = undefined;
  assert.equal(committed.changed, true);
  const final = await tool('get_score_overview');
  assert.equal(final.measureCount, phase === 'create' ? 2 : 3);
  console.log(JSON.stringify({ phase, sessionId, measures: final.measureCount, expressions: final.expressionCounts, status: 'passed' }));
} finally {
  if (checkoutId) { try { await tool('cancel_checkout', { checkoutId }); } catch { /* preserve original failure */ } }
  client.close();
}
