import type { FermataSettings, PianoNote, ScoreProject } from './types.ts';
import ScoreVoice from './score-voice.ts';
import MusicalTime from '../theory/musical-time.ts';

namespace ScoreFermata {
  export const defaults: FermataSettings = { lengthRatio: 2 };
  /** Positions use exact score fractions; adjacent ranges do not overlap. */
  function notes(project: ScoreProject) {
    let offset = MusicalTime.create(0);
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const measureStart = offset;
      offset = MusicalTime.add(offset, MusicalTime.create(block.data.length.cnt * 16, block.data.length.unit));
      return (['upperStaff', 'lowerStaff'] as const).flatMap(staff => block.data[staff].voices.flatMap((voice, voiceIndex) =>
        ScoreVoice.flatten(voice, block.data.length).flatMap(entry => {
          if (entry.element.kind !== 'note') return [];
          const start = MusicalTime.add(measureStart, entry.positionTime);
          return [{ note: entry.element, staff, voiceIndex, start, end: MusicalTime.add(start, entry.lengthTime) }];
        })));
    });
  }
  type Entry = ReturnType<typeof notes>[number];
  const overlaps = (a: Entry, b: Entry) => MusicalTime.compare(a.start, b.end) < 0 && MusicalTime.compare(b.start, a.end) < 0;

  export function conflict(project: ScoreProject, noteId: string): boolean {
    const entries = notes(project), target = entries.find(entry => entry.note.id === noteId);
    return !!target && entries.some(entry => entry.note.id !== noteId && entry.note.fermata &&
      overlaps(target, entry) && MusicalTime.compare(target.end, entry.end) !== 0);
  }
  export function hasConflicts(project: ScoreProject): boolean {
    const entries = notes(project).filter(entry => entry.note.fermata)
      .sort((a, b) => MusicalTime.compare(a.start, b.start));
    let active: Entry | undefined;
    for (const entry of entries) {
      if (active && overlaps(active, entry) && MusicalTime.compare(active.end, entry.end) !== 0) return true;
      if (!active || MusicalTime.compare(entry.start, active.end) >= 0) active = entry;
    }
    return false;
  }
  /** One effective hold per shared end: voice number first, then upper staff. */
  export function groups(project: ScoreProject, override?: { noteId: string; settings: FermataSettings | undefined }) {
    const entries = notes(project).map(entry => override?.noteId === entry.note.id
      ? { ...entry, note: { ...entry.note, fermata: override.settings } } : entry).filter(entry => entry.note.fermata)
      .sort((a, b) => MusicalTime.compare(a.start, b.start));
    const groups: Entry[][] = [];
    for (const entry of entries) {
      const previous = groups.at(-1);
      if (previous && MusicalTime.compare(previous[0].end, entry.end) === 0 && overlaps(previous[0], entry)) previous.push(entry);
      else groups.push([entry]);
    }
    return groups.map(members => {
      const priority = [...members].sort((a, b) => a.voiceIndex - b.voiceIndex ||
        Number(a.staff === 'lowerStaff') - Number(b.staff === 'lowerStaff'))[0];
      return { noteIds: members.map(entry => entry.note.id), priorityNoteId: priority.note.id,
        staff: priority.staff, voiceIndex: priority.voiceIndex, lengthRatio: priority.note.fermata!.lengthRatio,
        startSixteenths: MusicalTime.toNumber(members[0].start), endSixteenths: MusicalTime.toNumber(members[0].end) };
    });
  }

  export function capture(project: ScoreProject) {
    return new Map(notes(project).map(entry => [entry.note.id, { start: entry.start, end: entry.end,
      type: entry.note.value.type, dots: entry.note.value.dots }]));
  }
  /** All notes whose written value or absolute timing changed lose the attachment. */
  export function reconcileCaptured(previous: ReturnType<typeof capture>, project: ScoreProject, reapplied: ReadonlySet<string> = new Set()): ScoreProject {
    const removed = new Set(notes(project).filter(entry => {
      const old = previous.get(entry.note.id);
      return entry.note.fermata && !reapplied.has(entry.note.id) && old && (old.type !== entry.note.value.type || old.dots !== entry.note.value.dots ||
        MusicalTime.compare(old.start, entry.start) !== 0 || MusicalTime.compare(old.end, entry.end) !== 0);
    }).map(entry => entry.note.id));
    if (!removed.size) return project;
    return { ...project, outline: project.outline.map(block => block.type !== 'measure' ? block : { ...block,
      data: { ...block.data, ...Object.fromEntries((['upperStaff', 'lowerStaff'] as const).map(staff => [staff, {
        ...block.data[staff], voices: block.data[staff].voices.map(voice => ScoreVoice.mapNotes(voice, note => {
          if (!removed.has(note.id)) return note;
          const { fermata: _, ...rest } = note;
          return rest;
        })),
      }])) } }) as ScoreProject['outline'] };
  }
  export function canApply(note: Pick<PianoNote, 'tieTo'>): boolean { return !note.tieTo; }
  export function validate(value: unknown): value is FermataSettings {
    if (typeof value !== 'object' || value === null || !('lengthRatio' in value)) return false;
    const ratio = value.lengthRatio;
    return typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 1 && ratio <= 4 &&
      Math.abs(ratio * 10 - Math.round(ratio * 10)) < 1e-8;
  }
}
export default ScoreFermata;
