import { getFlattenedVoiceElements, type ScoreProject, type PianoStaffName } from './project.ts';
import { addTime, compareTime } from './rational.ts';

export type Clef = 'treble' | 'bass';
export function getClefAnchors(project: ScoreProject) {
  let start = 0;
  return project.outline.flatMap(block => {
    if (block.type !== 'measure') return [];
    const measureStart = start;
    start = addTime(start, block.data.length.cnt / block.data.length.unit * 16);
    return (['upperStaff', 'lowerStaff'] as const).flatMap(staff => {
      const voice = block.data[staff].voices[0];
      return voice ? getFlattenedVoiceElements(voice, block.data.length).flatMap(entry => entry.element.kind === 'note'
        ? [{ noteId: entry.element.id, position: addTime(measureStart, entry.positionSixteenths),
          measureId: block.id, localPosition: entry.positionSixteenths, staff }] : []) : [];
    });
  });
}
export function getClefChanges(project: ScoreProject) {
  const anchors = new Map(getClefAnchors(project).map(anchor => [anchor.noteId, anchor]));
  return (project.clefChanges ?? []).flatMap(change => {
    const anchor = anchors.get(change.noteId);
    return anchor && ['treble', 'bass'].includes(change.clef) ? [{ ...anchor, clef: change.clef }] : [];
  }).sort((a, b) => compareTime(a.position, b.position));
}
export function getClefAt(project: ScoreProject, staff: PianoStaffName, position: number): Clef {
  let clef: Clef = staff === 'upperStaff' ? 'treble' : 'bass';
  for (const change of getClefChanges(project)) {
    if (compareTime(change.position, position) > 0) break;
    if (change.staff === staff) clef = change.clef;
  }
  return clef;
}
export function setNoteClef(project: ScoreProject, noteId: string, clef: Clef | null): ScoreProject {
  const anchor = getClefAnchors(project).find(entry => entry.noteId === noteId);
  if (!anchor || (clef !== null && !['treble', 'bass'].includes(clef))) return project;
  const samePosition = new Set(getClefChanges(project).filter(entry => entry.staff === anchor.staff && compareTime(entry.position, anchor.position) === 0).map(entry => entry.noteId));
  const clefChanges = (project.clefChanges ?? []).filter(change => change.noteId !== noteId && !samePosition.has(change.noteId));
  if (clef !== null) clefChanges.push({ noteId, clef });
  return { ...project, clefChanges };
}
export function reconcileClefChanges(project: ScoreProject): ScoreProject {
  return project.clefChanges ? { ...project, clefChanges: getClefChanges(project).map(({ noteId, clef }) => ({ noteId, clef })) } : project;
}
