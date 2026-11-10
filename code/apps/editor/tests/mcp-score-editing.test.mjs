import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Contract from '../src/domain/score/score-edit-contract.ts';
import Authoring from '../src/action/editor/score-authoring.ts';
import Editing from '../src/action/editor/score-editing.ts';
import Factory from '../src/domain/score/score-project.ts';
import Timeline from '../src/domain/score/score-timeline.ts';
import Reader from '../src/service/mcp/mcp-score-reader.ts';
import Controller from '../src/service/mcp/mcp-editor-controller.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';
import Preview from '../src/infra/musicxml/preview-musicxml.ts';
import Playback from '../src/domain/performance/score-playback-plan.ts';

const n = (pitch, value = '4') => ({ value, pitches: Array.isArray(pitch) ? pitch : [pitch] });
function score(count = 2) {
  return Authoring.apply(Factory.create(), Authoring.createState(), [{ type: 'create_score',
    settings: { meter: [4, 4], keyFifths: 0, tempo: 100 }, measures: Array.from({ length: count }, () =>
      ({ upper: [[n('C4'), n('D4'), n(['E4', 'G4']), n('F4')]] })) }]).project;
}
const edit = (project, operations) => Editing.apply(project, Authoring.createState(), operations).project;
const ms = project => project.outline.filter(block => block.type === 'measure');
const ns = project => Timeline.notes(project.outline).map(entry => entry.note);
function fixture(project = score()) {
  let live = project;
  const writes = [], states = [];
  const controller = Controller.create({ getEditorState: project => ({ project }), checkoutBlocker: () => null,
    getEditContext: () => ({ project: live, timelineCursor: createTimelineCursor() }),
    updateProject: (before, next) => { assert.equal(before, live); live = next; writes.push(next); }, checkoutChanged: state => states.push(state) });
  const call = (method, params = {}) => controller.handle({ id: 'test', method, params: { ownerId: 'client', ...params } });
  let checkoutId, revision, sequence = 0;
  const begin = () => { const response = call('beginCheckout').result; checkoutId = response.checkoutId; revision = response.revision; return response; };
  const apply = operations => {
    const request = { checkoutId, expectedRevision: revision, requestId: `edit-${++sequence}`, operations };
    const result = call('applyEdit', request);
    if (result.result) revision = result.result.revision;
    return { request, result };
  };
  return { call, begin, apply, writes, states, live: () => live, checkout: () => checkoutId,
    externalChange: () => { live = structuredClone(live); live.outline[0].data.tempo++; } };
}

test('operation contract matches Rust schema, exposes every operation, and rejects unsupported fields', () => {
  const generated = JSON.parse(readFileSync(new URL('../../mcp/score-operations.schema.json', import.meta.url)));
  assert.deepEqual(generated, Contract.operations);
  assert.deepEqual(Reader.capabilities().operations, Contract.names);
  assert.ok(Reader.capabilities('set_grace_notes').operationSchema.properties.notes);
  assert.throws(() => Reader.capabilities('unknown'), /Unknown operation/);
  for (const fields of Object.values(Contract.fieldCoverage)) for (const operations of Object.values(fields)) {
    assert.ok(operations.length > 0);
    for (const operation of operations) assert.ok(Contract.names.includes(operation));
  }
  assert.throws(() => Contract.validate([{ type: 'set_pitches', noteId: 'x', pitches: ['C4'], arbitrary: true }]), /arbitrary/);
  assert.throws(() => Contract.validate([{ type: 'set_trill', noteId: 'x', settings: { auxiliary: 'diatonic', start: 'main', attackCount: 1 } }]), /attackCount/);
});

test('unlocked reads, revision guards, idempotent retries, and appending after a later checkout', () => {
  const f = fixture();
  const live = f.call('getScoreOverview').result;
  assert.equal(live.measureCount, 2); assert.equal(f.states.length, 0);
  const begin = f.begin(); assert.equal(begin.revision, live.revision);
  const firstNote = ns(f.live())[0];
  const change = f.apply([{ type: 'set_pitches', noteId: firstNote.id, pitches: ['C5'] }]);
  assert.equal(change.result.result.changed, true);
  assert.equal(ns(f.live())[0].pitches[0].midi, 60);
  assert.deepEqual(f.call('applyEdit', change.request), change.result);
  assert.equal(f.call('applyEdit', { ...change.request, requestId: 'stale' }).error.code, 'STALE_REVISION');
  const staged = f.call('getScoreRange', { checkoutId: f.checkout(), firstMeasure: 1, measureCount: 1 }).result;
  assert.equal(staged.measures[0].staves[0].voices[0].timeline[0].pitches[0].name, 'C5');
  assert.equal(f.call('getScoreRange', { firstMeasure: 1, measureCount: 1 }).result.measures[0].staves[0].voices[0].timeline[0].pitches[0].name, 'C4');
  assert.ok(f.call('finishCheckout', { checkoutId: f.checkout() }).result);
  f.begin();
  assert.ok(f.apply([{ type: 'append_measures', measures: [{}] }]).result.result);
  assert.ok(f.call('finishCheckout', { checkoutId: f.checkout() }).result);
  assert.equal(ms(f.live()).length, 3); assert.equal(f.writes.length, 2);
});

test('failed edits preserve project and revision; cancellation and user changes invalidate pending work', () => {
  const f = fixture(), initial = f.begin();
  const old = structuredClone(f.call('getEditorState', { checkoutId: initial.checkoutId }).result);
  const failure = f.apply([{ type: 'set_value', elementId: ns(f.live())[0].id, value: '2' }]).result;
  assert.equal(failure.error.code, 'INVALID_SCORE');
  assert.deepEqual(f.call('getEditorState', { checkoutId: initial.checkoutId }).result, old);
  assert.ok(f.call('cancelCheckout', { checkoutId: initial.checkoutId }).result);
  f.begin();
  assert.equal(f.call('getScoreRange', { checkoutId: initial.checkoutId }).error.code, 'CHECKOUT_REQUIRED');
  f.externalChange();
  assert.equal(f.call('finishCheckout', { checkoutId: f.checkout() }).error.code, 'PROJECT_CHANGED');
  assert.equal(f.writes.length, 0);
});

test('grace notes, trills, staccato, arpeggio and fingering survive rendering and playback', () => {
  let project = score(1);
  const notes = ns(project), [a, b, c] = notes;
  project = edit(project, [
    { type: 'set_grace_notes', noteId: a.id, notes: [{ pitch: 'B3', value: '16', slash: true, fingering: 2 }], performance: { spreadRatio: 0.5, timing: 0.5 } },
    { type: 'set_trill', noteId: a.id, settings: { auxiliary: 'half', start: 'auxiliary', attackCount: 128 } },
    { type: 'set_note_expression', noteId: b.id, staccato: { type: 'staccatissimo', lengthRatio: 0.2 } },
    { type: 'set_note_expression', noteId: c.id, arpeggio: { type: 'down', spreadRatio: 0.8, timing: 0.3 } },
    { type: 'set_fingering', noteId: c.id, pitchIndex: 0, fingering: 3, substitutionFingering: 4 },
  ]);
  const grace = ns(project)[0].beforeGraceNotes[0];
  project = edit(project, [{ type: 'set_fingering', noteId: a.id, graceNoteId: grace.id, pitchIndex: 0, fingering: 1 }]);
  assert.equal(ns(project)[0].beforeGraceNotes[0].pitches[0].fingering, 1);
  const playback = Playback.create(project, 0);
  assert.ok(playback.events.some(event => event.graceNote));
  assert.ok(playback.events.some(event => event.sourceNoteId.includes('-trill-')));
  assert.ok(playback.events.some(event => event.sourceNoteId.includes('-arpeggio-')));
  const preview = Preview.create(project.outline, 0, project.trills, project.tempoChanges, project.clefChanges, project.slurs);
  const text = JSON.stringify(preview);
  for (const token of ['grace', 'trill-mark', 'arpeggiate', 'staccatissimo', 'fingering']) assert.ok(text.includes(token), token);
  project = edit(project, [
    { type: 'set_grace_notes', noteId: a.id, notes: [] }, { type: 'set_trill', noteId: a.id, settings: null },
    { type: 'set_note_expression', noteId: b.id, staccato: null }, { type: 'set_note_expression', noteId: c.id, arpeggio: null },
    { type: 'set_fingering', noteId: c.id, pitchIndex: 0, fingering: null },
  ]);
  assert.equal(ns(project)[0].beforeGraceNotes, undefined); assert.equal(project.trills, undefined);
});

test('MCP accent settings round-trip, coexist with staccato and export once per chord', () => {
  let project = score(1);
  const chordId = ns(project)[2].id;
  project = edit(project, [{ type: 'set_note_expression', noteId: chordId,
    accent: { velocityRate: 1.5 }, staccato: { type: 'normal', lengthRatio: 0.5 } }]);
  project = edit(project, [{ type: 'set_note_expression', noteId: chordId, accent: { velocityRate: 2 } }]);
  const chord = ns(project).find(note => note.id === chordId);
  assert.equal(chord.accent.velocityRate, 2);
  assert.equal(chord.staccato.lengthRatio, 0.5);
  const read = Reader.range(project, { firstMeasure: 1, measureCount: 1 });
  assert.equal(read.measures[0].staves[0].voices[0].elements.find(note => note.id === chordId).accent.velocityRate, 2);
  const xml = JSON.stringify(Preview.create(project.outline, 0));
  assert.equal((xml.match(/<accent\/>/g) ?? []).length, 1);
  assert.ok(xml.includes('<staccato/>'));
  project = edit(project, [{ type: 'set_note_expression', noteId: chordId, accent: null }]);
  assert.equal(ns(project)[2].accent, undefined);
  assert.equal(ns(project)[2].staccato.lengthRatio, 0.5);
});

test('MCP rejects accent on incoming ties and invalid rates atomically, but allows removal', () => {
  let project = score(1);
  const [a, b] = ns(project);
  project = edit(project, [
    { type: 'set_pitches', noteId: b.id, pitches: ['C4'] },
    { type: 'set_note_expression', noteId: b.id, accent: { velocityRate: 1.5 } },
    { type: 'set_tie', fromNoteId: a.id, toNoteId: b.id },
  ]);
  // Adding a tie to an existing accent does not remove it in this iteration.
  assert.equal(ns(project)[1].accent.velocityRate, 1.5);
  const baseline = structuredClone(project);
  assert.throws(() => edit(project, [{ type: 'set_note_expression', noteId: b.id, accent: { velocityRate: 2 } }]), /tied from/);
  for (const velocityRate of [0.9, 2.1, 1.55]) {
    assert.throws(() => edit(project, [{ type: 'set_note_expression', noteId: a.id, accent: { velocityRate } }]));
  }
  assert.deepEqual(project, baseline);
  project = edit(project, [{ type: 'set_note_expression', noteId: b.id, accent: null }]);
  project = edit(project, [{ type: 'set_note_expression', noteId: a.id, accent: { velocityRate: 1 } }]);
  assert.equal(ns(project)[1].accent, undefined);
  assert.equal(ns(project)[0].accent.velocityRate, 1);
});

test('invalid ornament targets and relationships reject the entire candidate', () => {
  const project = score(1), notes = ns(project), baseline = structuredClone(project);
  for (const operations of [
    [{ type: 'set_grace_notes', noteId: notes[2].id, notes: [{ value: '8', pitch: 'C4', slash: true }] }],
    [{ type: 'set_trill', noteId: notes[2].id, settings: { auxiliary: 'whole', start: 'main', attackCount: 8 } }],
    [{ type: 'set_note_expression', noteId: notes[0].id, arpeggio: { type: 'normal', spreadRatio: 1, timing: 0 } }],
    [{ type: 'set_fingering', noteId: notes[0].id, pitchIndex: 0, fingering: 2, substitutionFingering: 2 }],
  ]) assert.throws(() => edit(project, operations));
  assert.deepEqual(project, baseline);
});

test('slur references are protected during voice replacement and can be explicitly removed', () => {
  let project = score(1), notes = ns(project), measureId = ms(project)[0].id;
  project = edit(project, [{ type: 'set_slur', startNoteId: notes[0].id, endNoteId: notes[3].id }]);
  const id = project.slurs[0].id;
  project = edit(project, [{ type: 'set_slur', slurId: id, startNoteId: notes[1].id, endNoteId: notes[3].id }]);
  const replace = { type: 'replace_voice', measureId, staff: 'upperStaff', voiceIndex: 0, events: [n('G4', '1')] };
  assert.throws(() => edit(project, [replace]), /slur endpoint/);
  project = edit(project, [replace, { type: 'remove_slur', slurId: id }]);
  assert.equal(ns(project)[0].pitches[0].midi, 67);
});

test('ties require adjacent same chords and explicit detachment when pitches change', () => {
  let project = score(1), notes = ns(project);
  project = edit(project, [{ type: 'set_pitches', noteId: notes[1].id, pitches: ['C4'] },
    { type: 'set_tie', fromNoteId: notes[0].id, toNoteId: notes[1].id }]);
  assert.throws(() => edit(project, [{ type: 'set_pitches', noteId: notes[0].id, pitches: ['C5'] }]), /Invalid tie/);
  project = edit(project, [{ type: 'set_tie', fromNoteId: notes[0].id, toNoteId: null }, { type: 'set_pitches', noteId: notes[0].id, pitches: ['C5'] }]);
  assert.equal(ns(project)[0].id, notes[0].id);
  assert.equal(ns(project)[1].tieFrom, undefined);
});

test('independent pedal and ottava events use exact quarter-note offsets, preserve IDs and reject orphan stops', () => {
  let project = score(2), blocks = ms(project);
  const position = (measureId, numerator, denominator = 1) => ({ measureId, offset: { numerator, denominator } });
  const start = position(blocks[0].id, 1, 3), end = position(blocks[1].id, 2);
  project = edit(project, [
    { type: 'set_pedal_event', position: start, action: 'start' }, { type: 'set_pedal_event', position: end, action: 'stop' },
    { type: 'set_ottava_event', position: start, staff: 'upperStaff', action: 'start' },
    { type: 'set_ottava_event', position: end, staff: 'upperStaff', action: 'stop' },
  ]);
  const queried = Reader.range(project, { firstMeasure: 2, measureCount: 1 });
  assert.equal(queried.measures[0].incoming.pedalDown, true);
  assert.deepEqual(queried.measures[0].incoming.ottavaActive, ['upperStaff']);
  assert.deepEqual(Reader.range(project, { firstMeasure: 1, measureCount: 1 }).measures[0].pedalEvents[0].offset, { numerator: 1, denominator: 3 });
  assert.throws(() => edit(project, [{ type: 'remove_pedal_event', position: start }]), /Orphaned/);
  project = edit(project, [{ type: 'remove_pedal_event', position: end }, { type: 'remove_pedal_event', position: start },
    { type: 'remove_ottava_event', position: start, staff: 'upperStaff' }, { type: 'remove_ottava_event', position: end, staff: 'upperStaff' }]);
  assert.equal(ms(project)[0].data.pedalEvents.length, 0);
});

test('tempo/clef changes, initial values, key changes and sections are editable after construction', () => {
  let project = score(2), blocks = ms(project), noteId = ns(project)[0].id;
  project = edit(project, [
    { type: 'set_tempo_change', noteId, bpm: 120 }, { type: 'set_clef_change', noteId, clef: 'bass' },
    { type: 'set_initial_values', settings: { meter: [3, 4], keyFifths: 1, tempo: 90 } },
    { type: 'set_key_change', beforeMeasureId: blocks[1].id, keyFifths: -1 },
    { type: 'insert_section', beforeMeasureId: blocks[1].id, name: 'B' },
  ]);
  const sectionId = project.outline.find(b => b.type === 'section' && b.data.name === 'B').id;
  project = edit(project, [{ type: 'rename_section', sectionId, name: 'Bridge' }, { type: 'remove_section', sectionId },
    { type: 'set_key_change', beforeMeasureId: blocks[1].id, keyFifths: -2 }, { type: 'set_key_change', beforeMeasureId: blocks[1].id, keyFifths: null },
    { type: 'set_clef_change', noteId, clef: null }, { type: 'set_tempo_change', noteId, bpm: null }]);
  assert.equal(project.outline[0].data.timeSignature.cnt, 3);
  assert.equal(ms(project)[0].data.length.cnt, 4); // Changing initial meter never rewrites existing music.
  assert.equal(project.outline.some(b => b.type === 'key-change'), false);
  assert.throws(() => edit(project, [{ type: 'remove_section', sectionId: project.outline[1].id }]), /first section/);
});

test('insert/remove measures, append/remove voices, rests, and paired duration edits preserve valid totals', () => {
  let project = score(1), block = ms(project)[0], notes = ns(project);
  project = edit(project, [{ type: 'set_value', elementId: notes[0].id, value: '4.' }, { type: 'set_value', elementId: notes[1].id, value: '8' },
    { type: 'set_rest', noteId: notes[3].id }, { type: 'replace_voice', measureId: block.id, staff: 'upperStaff', voiceIndex: 1, events: [n('C3', '1')] },
    { type: 'insert_measures', afterMeasureId: null, measures: [{}] }]);
  assert.equal(ms(project)[1].id, block.id);
  project = edit(project, [{ type: 'remove_voice', measureId: block.id, staff: 'upperStaff', voiceIndex: 1 },
    { type: 'remove_measures', measureIds: [ms(project)[0].id] }]);
  assert.equal(ms(project).length, 1); assert.equal(ms(project)[0].data.upperStaff.voices.length, 1);
});

test('short measures and mixed-value tuplets match persisted model constraints', () => {
  let project = score(1), block = ms(project)[0];
  project = edit(project, [{ type: 'set_measure_length', measureId: block.id, length: [1, 4] },
    { type: 'replace_voice', measureId: block.id, staff: 'upperStaff', voiceIndex: 0,
      events: [{ tuplet: { actual: 3, normal: 2, base: '8', events: [n('C4', '8.'), n('D4', '16'), n('E4', '8')] } }] }]);
  assert.equal(ms(project)[0].data.length.cnt, 1);
  assert.ok(Preview.create(project.outline, 0));
});

test('range filters retain original voice indices and bound responses', () => {
  const project = score(2), range = Reader.range(project, { firstMeasure: 2, measureCount: 1, staff: 'upperStaff', voiceIndex: 0 });
  assert.equal(range.measures[0].number, 2);
  assert.equal(range.measures[0].staves.length, 1);
  assert.deepEqual(range.measures[0].staves[0].voices[0].timeline[1].offset, { numerator: 1, denominator: 1 });
  assert.throws(() => Reader.range(project, { measureCount: 9 }), /measureCount/);
  assert.throws(() => Reader.bounded({ enormous: 'x'.repeat(201 * 1024) }), /smaller range/);
});

test('full voice replacement reports removed note IDs and their attached notation', () => {
  let project = score(1), noteId = ns(project)[0].id;
  project = edit(project, [{ type: 'set_grace_notes', noteId, notes: [{ pitch: 'B3', value: '16', slash: true }] }]);
  const graceId = ns(project)[0].beforeGraceNotes[0].id;
  const result = Editing.apply(project, Authoring.createState(), [{ type: 'replace_voice', measureId: ms(project)[0].id,
    staff: 'upperStaff', voiceIndex: 0, events: [n('C4', '1')] }]);
  assert.ok(result.summary.removedIds.includes(noteId));
  assert.ok(result.summary.removedIds.includes(graceId));
  assert.deepEqual(result.summary.removedNoteAttachments, [{ noteId, fields: ['beforeGraceNotes'] }]);
});

test('trailing sections and key changes can be created, updated and removed by block identity', () => {
  let project = score(1), blockId = ms(project)[0].id;
  project = edit(project, [{ type: 'insert_section', afterBlockId: blockId, name: 'Next' }]);
  const sectionId = project.outline.at(-1).id;
  project = edit(project, [{ type: 'set_key_change', afterBlockId: sectionId, keyFifths: -1 }]);
  const keyChangeId = project.outline.at(-1).id;
  project = edit(project, [{ type: 'set_key_change', keyChangeId, keyFifths: -2 }, { type: 'append_measures', measures: [{}] }]);
  assert.equal(Reader.range(project, { firstMeasure: 2, measureCount: 1 }).measures[0].keySignature.fifths, -2);
  project = edit(project, [{ type: 'set_key_change', keyChangeId, keyFifths: null }]);
  assert.equal(project.outline.some(block => block.type === 'key-change'), false);
});
