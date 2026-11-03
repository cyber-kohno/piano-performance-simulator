import type { ScoreProject } from './types.ts';
import MusicalTime from '../theory/musical-time.ts';
import ScoreVoice from './score-voice.ts';

namespace ScoreSlur {
  function notesInScore(project: ScoreProject) {
    let start = 0;
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const offset = start; start = MusicalTime.addNumbers(start, block.data.length.cnt / block.data.length.unit * 16);
      return (['upperStaff', 'lowerStaff'] as const).flatMap(staff => block.data[staff].voices.flatMap((voice, voiceIndex) =>
        ScoreVoice.flatten(voice, block.data.length).flatMap(entry => entry.element.kind === 'note'
          ? [{ note: entry.element, staff, voiceIndex, start: MusicalTime.addNumbers(offset, entry.positionSixteenths) }] : [])));
    });
  }
  export function ranges(project: ScoreProject) {
    const notes = notesInScore(project), byId = new Map(notes.map(entry => [entry.note.id, entry]));
    return (project.slurs ?? []).flatMap(slur => {
      const first = byId.get(slur.startNoteId), last = byId.get(slur.endNoteId);
      if (!first || !last || first.staff !== last.staff || first.voiceIndex !== last.voiceIndex || MusicalTime.compareNumbers(first.start, last.start) >= 0) return [];
      const members = notes.filter(entry => entry.staff === first.staff && entry.voiceIndex === first.voiceIndex &&
        MusicalTime.compareNumbers(entry.start, first.start) >= 0 && MusicalTime.compareNumbers(entry.start, last.start) <= 0);
      return [{ ...slur, first, last, members }];
    });
  }
  export function availability(project: ScoreProject, noteIds: readonly string[]) {
    const ids = new Set(noteIds), notes = notesInScore(project).filter(entry => ids.has(entry.note.id));
    const ranges = ScoreSlur.ranges(project);
    const first = notes[0], last = notes.at(-1);
    const sameVoice = notes.length === ids.size && notes.length > 0 && notes.every(entry => entry.staff === first.staff && entry.voiceIndex === first.voiceIndex);
    const overlap = sameVoice && ranges.some(range => range.first.staff === first.staff && range.first.voiceIndex === first.voiceIndex &&
      MusicalTime.compareNumbers(range.first.start, last!.start) <= 0 && MusicalTime.compareNumbers(range.last.start, first.start) >= 0);
    const shared = ranges.find(range => notes.length > 0 && notes.length === ids.size && notes.every(entry => range.members.some(member => member.note.id === entry.note.id)));
    return {
      canAdd: sameVoice && notes.length >= 2 && !overlap,
      canRemove: shared !== undefined,
      addReason: !sameVoice || notes.length < 2 ? 'Select at least two notes in the same staff and voice.' : overlap ? 'The range overlaps an existing slur.' : '',
      removeReason: shared ? '' : 'Every selected note must belong to the same slur.',
      firstId: first?.note.id, lastId: last?.note.id, slurId: shared?.id,
    };
  }
  export function add(project: ScoreProject, noteIds: readonly string[]): ScoreProject {
    const state = ScoreSlur.availability(project, noteIds);
    if (!state.canAdd) return project;
    return { ...project, slurs: [...(project.slurs ?? []), { id: `slur-${crypto.randomUUID()}`, startNoteId: state.firstId!, endNoteId: state.lastId! }] };
  }
  export function remove(project: ScoreProject, noteIds: readonly string[]): ScoreProject {
    const state = ScoreSlur.availability(project, noteIds);
    return state.canRemove ? { ...project, slurs: project.slurs?.filter(slur => slur.id !== state.slurId) } : project;
  }
  /** Endpoints are references, so ordinary moves follow automatically; deleted endpoints remove the span. */
  export function reconcile(project: ScoreProject): ScoreProject {
    if (!project.slurs) return project;
    const valid = new Set(ScoreSlur.ranges(project).map(slur => slur.id));
    return { ...project, slurs: project.slurs.filter(slur => valid.has(slur.id)) };
  }
}
export default ScoreSlur;
