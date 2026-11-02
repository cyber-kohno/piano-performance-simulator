import { getFlattenedVoiceElements, type ScoreProject } from './project.ts';
import { addTime, compareTime } from './rational.ts';
import { getMeterBeatLength } from '../state/measure-beats.ts';

export function getTempoAnchors(project: ScoreProject) {
  let start = 0;
  return project.outline.flatMap(block => {
    if (block.type !== 'measure') return [];
    const measureStart = start;
    start = addTime(start, block.data.length.cnt / block.data.length.unit * 16);
    const voice = block.data.upperStaff.voices[0];
    return voice ? getFlattenedVoiceElements(voice, block.data.length).flatMap(entry => entry.element.kind === 'note'
      ? [{ noteId: entry.element.id, position: addTime(measureStart, entry.positionSixteenths),
        measureId: block.id, localPosition: entry.positionSixteenths }] : []) : [];
  });
}
export function getTempoChanges(project: ScoreProject) {
  const anchors = new Map(getTempoAnchors(project).map(anchor => [anchor.noteId, anchor]));
  return (project.tempoChanges ?? []).flatMap(change => {
    const anchor = anchors.get(change.noteId);
    return anchor && Number.isInteger(change.bpm) && change.bpm >= 10 && change.bpm <= 400 ? [{ ...anchor, bpm: change.bpm }] : [];
  }).sort((a, b) => compareTime(a.position, b.position));
}
export function setNoteTempo(project: ScoreProject, noteId: string, bpm: number | null): ScoreProject {
  const anchor = getTempoAnchors(project).find(entry => entry.noteId === noteId);
  if (!anchor || (bpm !== null && (!Number.isInteger(bpm) || bpm < 10 || bpm > 400))) return project;
  const otherIds = new Set(getTempoChanges(project).filter(entry => compareTime(entry.position, anchor.position) === 0).map(entry => entry.noteId));
  const tempoChanges = (project.tempoChanges ?? []).filter(change => change.noteId !== noteId && !otherIds.has(change.noteId));
  if (bpm !== null) tempoChanges.push({ noteId, bpm });
  return { ...project, tempoChanges };
}
/** IDs follow moves and explicit value edits. Deleted anchors are removed, never copied. */
export function reconcileTempoChanges(project: ScoreProject): ScoreProject {
  if (!project.tempoChanges) return project;
  return { ...project, tempoChanges: getTempoChanges(project).map(({ noteId, bpm }) => ({ noteId, bpm })) };
}
export function getTempoAt(project: ScoreProject, position: number): number {
  let bpm = project.outline[0].data.tempo;
  for (const change of getTempoChanges(project)) {
    if (compareTime(change.position, position) > 0) break;
    bpm = change.bpm;
  }
  return bpm;
}
/** Integrate the shared tempo map, including changes inside sustained notes. */
export function getScoreTimeSeconds(project: ScoreProject, position: number): number {
  const beat = getMeterBeatLength(project.outline[0].data.timeSignature);
  const beatLength = beat.cnt / beat.unit * 16;
  let at = 0, seconds = 0, bpm = project.outline[0].data.tempo;
  for (const change of getTempoChanges(project)) {
    if (compareTime(change.position, position) >= 0) break;
    seconds += (change.position - at) / beatLength * 60 / bpm;
    at = change.position; bpm = change.bpm;
  }
  return seconds + (position - at) / beatLength * 60 / bpm;
}
