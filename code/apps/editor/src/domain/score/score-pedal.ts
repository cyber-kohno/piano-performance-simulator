
import MusicalTime from "../theory/musical-time.ts";
import { type ScoreProject, type PedalEvent } from "./types.ts";

namespace ScorePedal {
  export function measures(project: ScoreProject) {
    let start = 0;
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const length = block.data.length.cnt * 16 / block.data.length.unit;
      const entry = { measure: block, start, length };
      start = MusicalTime.addNumbers(start, length);
      return [entry];
    });
  }
  export function length(project: ScoreProject) {
    return measures(project).reduce((sum, entry) => MusicalTime.addNumbers(sum, entry.length), 0);
  }
  export function events(project: ScoreProject) {
    return measures(project).flatMap(({ measure, start }) =>
      (measure.data.pedalEvents ?? []).map(event => ({ ...event, position: MusicalTime.addNumbers(start, MusicalTime.toNumber(event.offset)) })))
      .sort((a, b) => a.position - b.position);
  }
  export function add(project: ScoreProject, position: number, action: PedalEvent['action']): ScoreProject {
    const measures = ScorePedal.measures(project);
    const length = ScorePedal.length(project);
    if (!Number.isFinite(position) || position < 0 || position > length || (position === length && action !== 'stop')) return project;
    const events = ScorePedal.events(project);
    if (events.some(event => event.position === position)) return project;
    const nextIndex = events.findIndex(event => event.position > position);
    const previousIndex = nextIndex < 0 ? events.length - 1 : nextIndex - 1;
    const previous = previousIndex >= 0 ? events[previousIndex] : undefined;
    const following = events.slice(previousIndex + 1);
    const down = previous !== undefined && previous.action !== 'stop';
    const removed = new Set<string>();
    let moved: PedalEvent | undefined;

    if (action === 'start' && down) {
      // Move the active span's start forward, but never across a retake.
      if (previous?.action !== 'start') return project;
      moved = previous;
    } else if (action === 'start') {
      // In a gap, move the next start earlier; otherwise create a new open span.
      const nextStart = following.find(event => event.action === 'start');
      if (nextStart) { moved = nextStart; }
    } else if (action === 'change') {
      if (!down) return project;
    } else if (action === 'stop' && down) {
      // A stop can shorten an unbroken span. Once a retake exists, only the
      // final segment may be shortened with a stop.
      if (following.some(event => event.action === 'change')) return project;
      moved = following.find(event => event.action === 'stop');
    } else if (action === 'stop') {
      // Extend the preceding span through the gap, stopping before the next start.
      if (previous?.action !== 'stop') return project;
      const nextStart = following.find(event => event.action === 'start');
      if (nextStart && position >= nextStart.position) return project;
      moved = previous;
    } else {
      return project;
    }

    if (moved) removed.add(moved.id);
    if (action === 'stop' && down) {
      // An earlier stop removes intervening changes and the old stop.
      for (const event of following) {
        if (event.action === 'start') break;
        removed.add(event.id);
        if (event.action === 'stop') break;
      }
    }
    const owner = measures.find(entry => position >= entry.start && position < entry.start + entry.length)
      ?? (position === length ? measures.at(-1) : undefined);
    if (!owner) return project;
    const event: PedalEvent = moved
      ? { ...moved, offset: MusicalTime.fromNumber(position - owner.start) }
      : { id: `pedal-${crypto.randomUUID()}`, offset: MusicalTime.fromNumber(position - owner.start), action };
    return {
      ...project, outline: project.outline.map(block => {
        if (block.type !== 'measure') return block;
        const retained = (block.data.pedalEvents ?? []).filter(entry => !removed.has(entry.id));
        if (block.id === owner.measure.id) retained.push(event);
        return { ...block, data: { ...block.data, pedalEvents: retained.sort((a, b) => MusicalTime.toNumber(a.offset) - MusicalTime.toNumber(b.offset)) } };
      }) as ScoreProject['outline']
    };
  }
  export function remove(project: ScoreProject, position: number): ScoreProject {
    const events = ScorePedal.events(project);
    const index = events.findIndex(event => event.position === position);
    if (index < 0) return project;
    const removed = new Set([events[index].id]);
    if (events[index].action === 'start') {
      for (const event of events.slice(index + 1)) {
        removed.add(event.id);
        if (event.action === 'stop') break;
      }
    } else if (events[index].action === 'stop' && events[index + 1]?.action === 'start') {
      removed.add(events[index + 1].id);
    }
    return {
      ...project, outline: project.outline.map(block => block.type === 'measure'
        ? { ...block, data: { ...block.data, pedalEvents: (block.data.pedalEvents ?? []).filter(event => !removed.has(event.id)) } } : block) as ScoreProject['outline']
    };
  }
  export function spans(project: ScoreProject, { splitAtChanges = false } = {}) {
    const spans: { start: number; end: number }[] = [];
    let start: number | undefined;
    for (const event of events(project)) {
      if (event.action === 'start') start = event.position;
      if (event.action === 'change' && start !== undefined && splitAtChanges) {
        spans.push({ start, end: event.position });
        start = event.position;
      }
      if (event.action === 'stop' && start !== undefined) { spans.push({ start, end: event.position }); start = undefined; }
    }
    if (start !== undefined) spans.push({ start, end: length(project) });
    return spans;
  }

  /** Removing a measure also removes its events; discard resulting orphan directions. */
  export function reconcile(outline: ScoreProject['outline']): ScoreProject['outline'] {
    let down = false;
    const valid = new Set<string>();
    for (const event of events({ outline })) {
      if (event.action === 'start') {
        if (down) continue;
        down = true;
      } else {
        if (!down) continue;
        if (event.action === 'stop') down = false;
      }
      valid.add(event.id);
    }
    return outline.map(block => {
      if (block.type !== 'measure' || !block.data.pedalEvents?.some(event => !valid.has(event.id))) return block;
      return { ...block, data: { ...block.data, pedalEvents: block.data.pedalEvents.filter(event => valid.has(event.id)) } };
    }) as ScoreProject['outline'];
  }

}
export default ScorePedal;
