import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlaybackHighlight } from '../src/service/playback/playback-highlight.ts';
const event = (sourceNoteId, startSeconds, durationSeconds, extra = {}) => ({ sourceNoteId, startSeconds, durationSeconds, pitches: [60], ...extra });
test('attack and release boundaries, overlapping instances and gaps follow the audio clock', () => {
 const read = createPlaybackHighlight([event('a', 0, 1), event('a', .5, 1), event('b', 1, .2)]);
 assert.deepEqual(read(0), ['a']); const first = read(.1); assert.equal(read(.2), first);
 assert.deepEqual(read(1).sort(), ['a','b']); assert.deepEqual(read(1.2), ['a']); assert.deepEqual(read(1.5), []);
 assert.deepEqual(read(0), ['a']); assert.deepEqual(read(9), []);
});
test('ornaments map to notation IDs and chords release after the last independently held pitch', () => {
 const read = createPlaybackHighlight([event('synthetic-arpeggio-0', 0, 1, { notationNoteIds: ['written'], pitchDurationsSeconds: [.2, 1] }), event('synthetic-grace-0', 1, .1, { notationNoteIds: ['grace'] })]);
 assert.deepEqual(read(.3), ['written']); assert.deepEqual(read(1), ['grace']); assert.deepEqual(read(1.1), []);
});
test('ties follow written segments while the underlying attack remains held', () => {
 const read = createPlaybackHighlight([event('head', 0, 2, { notationRanges: [{ noteId: 'head', startSeconds: 0, endSeconds: 1 }, { noteId: 'tail', startSeconds: 1 }] })]);
 assert.deepEqual(read(.9), ['head']); assert.deepEqual(read(1), ['tail']); assert.deepEqual(read(2), []);
});
