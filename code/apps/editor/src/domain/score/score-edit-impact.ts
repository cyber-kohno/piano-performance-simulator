import ScoreVoice from './score-voice.ts';
import type { PianoNote, ScoreProject } from './types.ts';

namespace ScoreEditImpact {
  function inspect(project: ScoreProject) {
    const ids = new Set<string>();
    const notes = new Map<string, PianoNote>();
    for (const block of project.outline) {
      ids.add(block.id);
      if (block.type !== 'measure') continue;
      for (const event of [...(block.data.pedalEvents ?? []), ...(block.data.ottavaEvents ?? [])]) ids.add(event.id);
      for (const staff of [block.data.upperStaff, block.data.lowerStaff]) for (const voice of staff.voices) {
        for (const element of voice.elements) if (element.kind === 'tuplet') ids.add(element.id);
        for (const { element } of ScoreVoice.flatten(voice, block.data.length)) {
          ids.add(element.id);
          if (element.kind !== 'note') continue;
          notes.set(element.id, element);
          for (const grace of element.beforeGraceNotes ?? []) ids.add(grace.id);
        }
      }
    }
    for (const span of [...(project.slurs ?? []), ...(project.trills ?? [])]) ids.add(span.id);
    return { ids, notes };
  }

  export function compare(before: ScoreProject, after: ScoreProject) {
    const previous = inspect(before), next = inspect(after);
    const fields = ['beforeGraceNotes', 'gracePerformance', 'staccato', 'arpeggio'] as const;
    const removedNoteAttachments = [...previous.notes].flatMap(([noteId, note]) => {
      const target = next.notes.get(noteId);
      const removed = fields.filter(field => note[field] !== undefined && target?.[field] === undefined);
      if (note.pitches.some(pitch => pitch.fingering !== undefined) && !target?.pitches.some(pitch => pitch.fingering !== undefined))
        return [{ noteId, fields: [...removed, 'fingering'] }];
      return removed.length ? [{ noteId, fields: [...removed] }] : [];
    });
    const removedAnchors = (['tempoChanges', 'clefChanges'] as const).flatMap(kind => (before[kind] ?? [])
      .filter(change => !(after[kind] ?? []).some(next => next.noteId === change.noteId)).map(change => ({ kind, noteId: change.noteId })));
    return { removedIds: [...previous.ids].filter(id => !next.ids.has(id)), removedNoteAttachments, removedAnchors };
  }
}
export default ScoreEditImpact;
