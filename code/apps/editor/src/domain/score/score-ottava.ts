import MusicalTime from '../theory/musical-time.ts';
import type { OttavaEvent, PianoStaffName, ScoreProject } from './types.ts';

namespace ScoreOttava {
  export function measures(project: Pick<ScoreProject, 'outline'>) {
    let start = 0;
    return project.outline.flatMap(block => {
      if (block.type !== 'measure') return [];
      const length = block.data.length.cnt * 16 / block.data.length.unit;
      const entry = { measure: block, start, length };
      start = MusicalTime.addNumbers(start, length);
      return [entry];
    });
  }
  export function length(project: Pick<ScoreProject, 'outline'>) {
    return measures(project).reduce((sum, entry) => MusicalTime.addNumbers(sum, entry.length), 0);
  }
  export function events(project: Pick<ScoreProject, 'outline'>, staff?: PianoStaffName) {
    return measures(project).flatMap(({ measure, start }) => (measure.data.ottavaEvents ?? [])
      .filter(event => staff === undefined || event.staff === staff)
      .map(event => ({ ...event, position: MusicalTime.addNumbers(start, MusicalTime.toNumber(event.offset)) })))
      .sort((a, b) => a.position - b.position || a.staff.localeCompare(b.staff));
  }
  export function spans(project: Pick<ScoreProject, 'outline'>, staff: PianoStaffName) {
    let start: number | undefined;
    const result: { start: number; end: number }[] = [];
    for (const event of events(project, staff)) {
      if (event.action === 'start') start = event.position;
      else if (start !== undefined) { result.push({ start, end: event.position }); start = undefined; }
    }
    if (start !== undefined) result.push({ start, end: length(project) });
    return result;
  }
  export function add(project: ScoreProject, position: number, staff: PianoStaffName, action: OttavaEvent['action']): ScoreProject {
    const measures = ScoreOttava.measures(project), total = ScoreOttava.length(project);
    if (!Number.isFinite(position) || position < 0 || position > total || (position === total && action !== 'stop')) return project;
    const events = ScoreOttava.events(project, staff);
    if (events.some(event => event.position === position)) return project;
    const nextIndex = events.findIndex(event => event.position > position);
    const previousIndex = nextIndex < 0 ? events.length - 1 : nextIndex - 1;
    const previous = previousIndex >= 0 ? events[previousIndex] : undefined;
    const following = events.slice(previousIndex + 1);
    const active = previous?.action === 'start';
    let moved: (typeof events)[number] | undefined;
    if (action === 'start' && active) {
      if (previous.action !== 'start') return project;
      moved = previous;
    } else if (action === 'start') {
      moved = following.find(event => event.action === 'start');
    } else if (active) {
      moved = following.find(event => event.action === 'stop');
    } else {
      if (previous?.action !== 'stop') return project;
      const nextStart = following.find(event => event.action === 'start');
      if (nextStart && position >= nextStart.position) return project;
      moved = previous;
    }
    const owner = measures.find(entry => position >= entry.start && position < entry.start + entry.length)
      ?? (position === total ? measures.at(-1) : undefined);
    if (!owner) return project;
    const removed = new Set(moved ? [moved.id] : []);
    const event: OttavaEvent = moved
      ? { ...moved, offset: MusicalTime.fromNumber(position - owner.start) }
      : { id: `ottava-${crypto.randomUUID()}`, offset: MusicalTime.fromNumber(position - owner.start), staff, action };
    return { ...project, outline: project.outline.map(block => {
      if (block.type !== 'measure') return block;
      const retained = (block.data.ottavaEvents ?? []).filter(entry => !removed.has(entry.id));
      if (block.id === owner.measure.id) retained.push(event);
      return { ...block, data: { ...block.data, ottavaEvents: retained.sort((a, b) => MusicalTime.compare(a.offset, b.offset)) } };
    }) as ScoreProject['outline'] };
  }
  export function remove(project: ScoreProject, position: number, staff: PianoStaffName): ScoreProject {
    const events = ScoreOttava.events(project, staff), index = events.findIndex(event => event.position === position);
    if (index < 0) return project;
    const removed = new Set([events[index].id]);
    if (events[index].action === 'start') {
      for (const event of events.slice(index + 1)) { removed.add(event.id); if (event.action === 'stop') break; }
    } else if (events[index + 1]?.action === 'start') removed.add(events[index + 1].id);
    return { ...project, outline: project.outline.map(block => block.type === 'measure'
      ? { ...block, data: { ...block.data, ottavaEvents: (block.data.ottavaEvents ?? []).filter(event => !removed.has(event.id)) } } : block) as ScoreProject['outline'] };
  }
  /** Drop orphan endpoints and repeated starts after a measure has been removed. */
  export function reconcile(outline: ScoreProject['outline']): ScoreProject['outline'] {
    const valid = new Set<string>();
    for (const staff of ['upperStaff', 'lowerStaff'] as const) {
      let active = false;
      for (const event of events({ outline }, staff)) {
        if (event.action === 'start') { if (active) continue; active = true; }
        else { if (!active) continue; active = false; }
        valid.add(event.id);
      }
    }
    return outline.map(block => block.type !== 'measure' || !block.data.ottavaEvents?.some(event => !valid.has(event.id)) ? block
      : { ...block, data: { ...block.data, ottavaEvents: block.data.ottavaEvents.filter(event => valid.has(event.id)) } }) as ScoreProject['outline'];
  }
}
export default ScoreOttava;
