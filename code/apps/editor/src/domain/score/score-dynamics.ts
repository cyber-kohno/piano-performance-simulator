import ScoreTempo from './score-tempo.ts';
import MusicalTime from '../theory/musical-time.ts';
import type { DynamicLevel, ScoreProject } from './types.ts';

namespace ScoreDynamics {
  export const levels: readonly DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  export const defaultLevel: DynamicLevel = 'mf';
  export const anchors = ScoreTempo.anchors;
  export function isLevel(level: unknown): level is DynamicLevel {
    return typeof level === 'string' && levels.includes(level as DynamicLevel);
  }
  export function changes(project: ScoreProject) {
    const byId = new Map(anchors(project).map(anchor => [anchor.noteId, anchor]));
    return (project.dynamicChanges ?? []).flatMap(change => {
      const anchor = byId.get(change.noteId);
      return anchor && isLevel(change.level) ? [{ ...anchor, level: change.level }] : [];
    }).sort((a, b) => MusicalTime.compareNumbers(a.position, b.position));
  }
  export function isValid(project: ScoreProject): boolean {
    const saved = project.dynamicChanges ?? [];
    return new Set(saved.map(change => change.noteId)).size === saved.length && changes(project).length === saved.length;
  }
  /** Includes simultaneous attacks on every staff and voice; held pitches are not retriggered. */
  export function at(project: ScoreProject, position: number): DynamicLevel {
    let level = defaultLevel;
    for (const change of changes(project)) {
      if (MusicalTime.compareNumbers(change.position, position) > 0) break;
      level = change.level;
    }
    return level;
  }
  export function set(project: ScoreProject, noteId: string, level: DynamicLevel | null): ScoreProject {
    if (!anchors(project).some(anchor => anchor.noteId === noteId) || (level !== null && !isLevel(level))) return project;
    const dynamicChanges = (project.dynamicChanges ?? []).filter(change => change.noteId !== noteId);
    if (level !== null) dynamicChanges.push({ noteId, level });
    return { ...project, dynamicChanges };
  }
  /** Movement follows IDs. Deleting/resting an anchor removes its change without copying it. */
  export function reconcile(project: ScoreProject): ScoreProject {
    return project.dynamicChanges ? { ...project, dynamicChanges: changes(project).map(({ noteId, level }) => ({ noteId, level })) } : project;
  }
}
export default ScoreDynamics;
