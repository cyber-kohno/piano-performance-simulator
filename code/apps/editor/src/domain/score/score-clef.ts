import type { ScoreProject, PianoStaffName } from './types.ts';
import MusicalTime from '../theory/musical-time.ts';
import ScoreVoice from './score-voice.ts';
import ScoreTimeline from './score-timeline.ts';
export type Clef = 'treble' | 'bass';
namespace ScoreClef {
  function anchor(project: ScoreProject, noteId: string) {
    for (const staff of ['upperStaff', 'lowerStaff'] as const) {
      const entry = ScoreTimeline.note(project.outline, noteId, staff);
      if (entry?.voiceIndex === 0) return { noteId, position: MusicalTime.addNumbers(entry.measureStartSixteenths, entry.positionSixteenths),
        measureId: entry.measure.id, localPosition: entry.positionSixteenths, staff };
    }
    return undefined;
  }
  export function anchors(project: ScoreProject) {
    let start = 0;
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const measureStart = start;
      start = MusicalTime.addNumbers(start, block.data.length.cnt / block.data.length.unit * 16);
      return (['upperStaff', 'lowerStaff'] as const).flatMap(staff => {
        const voice = block.data[staff].voices[0];
        return voice ? ScoreVoice.flatten(voice, block.data.length).flatMap(entry => entry.element.kind === 'note'
          ? [{ noteId: entry.element.id, position: MusicalTime.addNumbers(measureStart, entry.positionSixteenths),
            measureId: block.id, localPosition: entry.positionSixteenths, staff }] : []) : [];
      });
    });
  }
  export function changes(project: ScoreProject) {
    if (!project.clefChanges?.length) return [];
    const anchors = ScoreTimeline.isPrepared(project.outline) ? undefined : new Map(ScoreClef.anchors(project).map(anchor => [anchor.noteId, anchor]));
    return (project.clefChanges ?? []).flatMap(change => {
      const target = anchors ? anchors.get(change.noteId) : anchor(project, change.noteId);
      return target && ['treble', 'bass'].includes(change.clef) ? [{ ...target, clef: change.clef }] : [];
    }).sort((a, b) => MusicalTime.compareNumbers(a.position, b.position));
  }
  export function at(project: ScoreProject, staff: PianoStaffName, position: number): Clef {
    let clef: Clef = staff === 'upperStaff' ? 'treble' : 'bass';
    for (const change of ScoreClef.changes(project)) {
      if (MusicalTime.compareNumbers(change.position, position) > 0) break;
      if (change.staff === staff) clef = change.clef;
    }
    return clef;
  }
  export function set(project: ScoreProject, noteId: string, clef: Clef | null): ScoreProject {
    const anchor = ScoreClef.anchors(project).find(entry => entry.noteId === noteId);
    if (!anchor || (clef !== null && !['treble', 'bass'].includes(clef))) return project;
    const samePosition = new Set(ScoreClef.changes(project).filter(entry => entry.staff === anchor.staff && MusicalTime.compareNumbers(entry.position, anchor.position) === 0).map(entry => entry.noteId));
    const clefChanges = (project.clefChanges ?? []).filter(change => change.noteId !== noteId && !samePosition.has(change.noteId));
    if (clef !== null) clefChanges.push({ noteId, clef });
    return { ...project, clefChanges };
  }
  export function reconcile(project: ScoreProject): ScoreProject {
    return project.clefChanges ? { ...project, clefChanges: ScoreClef.changes(project).map(({ noteId, clef }) => ({ noteId, clef })) } : project;
  }
}
export default ScoreClef;
