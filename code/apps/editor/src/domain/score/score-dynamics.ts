import ScoreTempo from './score-tempo.ts';
import MusicalTime from '../theory/musical-time.ts';
import ScoreTimeline from './score-timeline.ts';
import type { DynamicLevel, ScoreProject } from './types.ts';

namespace ScoreDynamics {
  export const levels: readonly DynamicLevel[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  export const defaultLevel: DynamicLevel = 'mf';
  export const defaultVelocities: Record<DynamicLevel, number> = { ppp: 48, pp: 62, p: 75, mp: 82, mf: 88, f: 98, ff: 108, fff: 118 };
  export function isVelocity(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 127; }
  export function velocityAt(project: ScoreProject, position: number): number {
    let velocity = 88;
    for (const change of changes(project)) {
      if (MusicalTime.compareNumbers(change.position, position) > 0) break;
      velocity = change.velocity;
    }
    return velocity;
  }
  export const anchors = ScoreTempo.anchors;
  export function isLevel(level: unknown): level is DynamicLevel {
    return typeof level === 'string' && levels.includes(level as DynamicLevel);
  }
  export function changes(project: ScoreProject) {
    if (!project.dynamicChanges?.length) return [];
    const byId = ScoreTimeline.isPrepared(project.outline) ? undefined : new Map(anchors(project).map(anchor => [anchor.noteId, anchor]));
    return (project.dynamicChanges ?? []).flatMap(change => {
      const anchor = byId ? byId.get(change.noteId) : ScoreTempo.anchor(project, change.noteId);
      return anchor && isLevel(change.level) && isVelocity(change.velocity) ? [{ ...anchor, level: change.level, velocity: change.velocity }] : [];
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
  export function set(project: ScoreProject, noteId: string, level: DynamicLevel | null, velocity?: number): ScoreProject {
    if (!anchors(project).some(anchor => anchor.noteId === noteId) || (level !== null && (!isLevel(level) || !isVelocity(velocity)))) return project;
    const dynamicChanges = (project.dynamicChanges ?? []).filter(change => change.noteId !== noteId);
    if (level !== null) dynamicChanges.push({ noteId, level, velocity: velocity! });
    return { ...project, dynamicChanges };
  }
  /** Movement follows IDs. Deleting/resting an anchor removes its change without copying it. */
  export function reconcile(project: ScoreProject): ScoreProject {
    return project.dynamicChanges ? { ...project, dynamicChanges: changes(project).map(({ noteId, level, velocity }) => ({ noteId, level, velocity })) } : project;
  }
}
export default ScoreDynamics;
