import type { ScoreProject } from './types.ts';
import MusicalTime from '../theory/musical-time.ts';
import ScoreVoice from './score-voice.ts';
import ScoreTimeline from './score-timeline.ts';

namespace ScoreTempo {
  export function anchor(project: ScoreProject, noteId: string) {
    if (!ScoreTimeline.isPrepared(project.outline)) return anchors(project).find(anchor => anchor.noteId === noteId);
    const entry = ScoreTimeline.note(project.outline, noteId, 'upperStaff');
    return entry?.voiceIndex === 0 ? { noteId, position: MusicalTime.addNumbers(entry.measureStartSixteenths, entry.positionSixteenths),
      measureId: entry.measure.id, localPosition: entry.positionSixteenths } : undefined;
  }
  export function anchors(project: ScoreProject) {
    let start = 0;
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const measureStart = start;
      start = MusicalTime.addNumbers(start, block.data.length.cnt / block.data.length.unit * 16);
      const voice = block.data.upperStaff.voices[0];
      return voice ? ScoreVoice.flatten(voice, block.data.length).flatMap(entry => entry.element.kind === 'note'
        ? [{ noteId: entry.element.id, position: MusicalTime.addNumbers(measureStart, entry.positionSixteenths),
          measureId: block.id, localPosition: entry.positionSixteenths }] : []) : [];
    });
  }
  export function changes(project: ScoreProject) {
    if (!project.tempoChanges?.length) return [];
    const anchors = ScoreTimeline.isPrepared(project.outline) ? undefined : new Map(ScoreTempo.anchors(project).map(anchor => [anchor.noteId, anchor]));
    return (project.tempoChanges ?? []).flatMap(change => {
      const anchor = anchors ? anchors.get(change.noteId) : ScoreTempo.anchor(project, change.noteId);
      return anchor && Number.isInteger(change.bpm) && change.bpm >= 10 && change.bpm <= 400 ? [{ ...anchor, bpm: change.bpm }] : [];
    }).sort((a, b) => MusicalTime.compareNumbers(a.position, b.position));
  }
  export function set(project: ScoreProject, noteId: string, bpm: number | null): ScoreProject {
    const anchor = ScoreTempo.anchors(project).find(entry => entry.noteId === noteId);
    if (!anchor || (bpm !== null && (!Number.isInteger(bpm) || bpm < 10 || bpm > 400))) return project;
    const otherIds = new Set(ScoreTempo.changes(project).filter(entry => MusicalTime.compareNumbers(entry.position, anchor.position) === 0).map(entry => entry.noteId));
    const tempoChanges = (project.tempoChanges ?? []).filter(change => change.noteId !== noteId && !otherIds.has(change.noteId));
    if (bpm !== null) tempoChanges.push({ noteId, bpm });
    return { ...project, tempoChanges };
  }
  /** IDs follow moves and explicit value edits. Deleted anchors are removed, never copied. */
  export function reconcile(project: ScoreProject): ScoreProject {
    if (!project.tempoChanges) return project;
    return { ...project, tempoChanges: ScoreTempo.changes(project).map(({ noteId, bpm }) => ({ noteId, bpm })) };
  }
  export function at(project: ScoreProject, position: number): number {
    let bpm = project.outline[0].data.tempo;
    for (const change of ScoreTempo.changes(project)) {
      if (MusicalTime.compareNumbers(change.position, position) > 0) break;
      bpm = change.bpm;
    }
    return bpm;
  }
}
export default ScoreTempo;
