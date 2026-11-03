import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPreviewNotes, createPreviewSelectionPainter } from '../src/model/score-preview-selection.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { addTimelineNoteAt, createTimelineCursor, addFocusedNotePitch } from '../src/state/timeline-cursor.ts';
import { createScorePreview } from '../src/model/score-preview.ts';

function element(children = [], fill = 'black', stroke = 'none') {
  const values = new Map();
  return { children, computed: { fill, stroke }, querySelectorAll: () => children,
    style: { getPropertyValue: key => values.get(key)?.value ?? '', getPropertyPriority: key => values.get(key)?.priority ?? '',
      setProperty: (key, value, priority = '') => values.set(key, { value, priority }), removeProperty: key => values.delete(key) } };
}
function note(position, voice, heads, grace = false, stem) {
  return { sourceNote: { ParentVoiceEntry: { IsGrace: grace, Timestamp: { RealValue: position / 16 }, ParentVoice: { VoiceId: voice } } },
    getNoteheadSVGs: () => heads, getStemSVG: () => stem };
}
test('mapping distinguishes simultaneous staff/voice notes, collects chord heads and excludes grace notes', () => {
  const a = element(), b = element(), lower = element(), secondVoice = element(), grace = element();
  const renderer = { GraphicSheet: { MeasureList: [[
    { staffEntries: [{ graphicalVoiceEntries: [{ notes: [note(4 / 3, 1, [a, b]), note(4 / 3, 1, [grace], true), note(4 / 3, 2, [secondVoice])] }] }] },
    { staffEntries: [{ graphicalVoiceEntries: [{ notes: [note(4 / 3, 4, [lower])] }] }] },
  ]] } };
  const targets = [{ noteId: 'a', measureOffset: 0, staffIndex: 0, voiceNumber: 1, position: 4 / 3 },
    { noteId: 'b', measureOffset: 0, staffIndex: 1, voiceNumber: 4, position: 4 / 3 }];
  const mapped = mapPreviewNotes(renderer, targets);
  assert.deepEqual([...mapped.get('a')], [a, b]);
  assert.deepEqual([...mapped.get('b')], [lower]);
});

test('selection updates colors without rendering and restores existing styles and none strokes', () => {
  const originalComputed = globalThis.getComputedStyle;
  globalThis.getComputedStyle = el => el.computed;
  try {
    const path = element([], 'black', 'none'), head = element([path]);
    const stem = element([], 'none', 'black'), other = element();
    path.style.setProperty('fill', '#123456', 'important');
    const paint = createPreviewSelectionPainter(new Map([['a', new Set([head, stem])], ['b', new Set([other])]]));
    paint(['a']);
    assert.equal(path.style.getPropertyValue('fill'), '#2b8c46');
    assert.equal(path.style.getPropertyValue('stroke'), '');
    assert.equal(stem.style.getPropertyValue('fill'), '');
    assert.equal(stem.style.getPropertyValue('stroke'), '#2b8c46');
    paint(['a', 'b', 'outside-preview']);
    assert.equal(path.style.getPropertyValue('fill'), '#c62828');
    assert.equal(other.style.getPropertyValue('fill'), '#c62828');
    paint(['b']);
    assert.equal(path.style.getPropertyValue('fill'), '#123456');
    assert.equal(path.style.getPropertyPriority('fill'), 'important');
    assert.equal(stem.style.getPropertyValue('stroke'), '');
    paint([]);
    assert.equal(other.style.getPropertyValue('fill'), '');
  } finally { globalThis.getComputedStyle = originalComputed; }
});

test('preview targets are per note column rather than pitch, and positions are local to each measure', () => {
  const project = createProject();
  project.outline.push({ id: 'm0', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) },
    { id: 'm1', type: 'measure', data: createMeasureData({ cnt: 4, unit: 4 }) });
  const first = addTimelineNoteAt(project, createTimelineCursor(), 0);
  const chord = addFocusedNotePitch(first.project, first.cursor);
  const lower = addTimelineNoteAt(chord.project, createTimelineCursor('lowerStaff'), 18, 48);
  const preview = createScorePreview(lower.project.outline, 0);
  assert.equal(preview.noteTargets.length, 2);
  assert.deepEqual(preview.noteTargets[1], { noteId: lower.cursor.focusedNoteId, measureOffset: 1, staffIndex: 1, voiceNumber: 4, position: 2 });
});
