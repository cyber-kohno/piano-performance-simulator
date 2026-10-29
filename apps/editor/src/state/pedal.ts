import { type ScoreProject, type PedalEvent, type NoteValue, getNoteValueSixteenths } from '../model/project.ts';
import { addTime, fromNumber, toNumber } from '../model/rational.ts';

export type PedalCursor = { position: number; value: NoteValue };
export const createPedalCursor = (): PedalCursor => ({ position: 0, value: { type: 'quarter', dots: 0 } });
export function getPedalMeasures(project: ScoreProject) {
  let start = 0;
  return project.outline.flatMap(block => {
    if (block.type !== 'measure') return [];
    const length = block.data.length.cnt * 16 / block.data.length.unit;
    const entry = { measure: block, start, length };
    start = addTime(start, length);
    return [entry];
  });
}
export function getPedalLength(project: ScoreProject) {
  return getPedalMeasures(project).reduce((sum, entry) => addTime(sum, entry.length), 0);
}
export function getPedalEvents(project: ScoreProject) {
  return getPedalMeasures(project).flatMap(({ measure, start }) =>
    (measure.data.pedalEvents ?? []).map(event => ({ ...event, position: addTime(start, toNumber(event.offset)) })))
    .sort((a, b) => a.position - b.position);
}
export function movePedalCursor(project: ScoreProject, cursor: PedalCursor, direction: -1 | 1): PedalCursor {
  return { ...cursor, position: Math.max(0, Math.min(getPedalLength(project),
    addTime(cursor.position, direction * getNoteValueSixteenths(cursor.value)))) };
}
export function addPedalEvent(project: ScoreProject, position: number, action: PedalEvent['action']): ScoreProject {
  const measures = getPedalMeasures(project);
  const length = getPedalLength(project);
  if (!Number.isFinite(position) || position < 0 || position > length || (position === length && action !== 'stop')) return project;
  const events = getPedalEvents(project);
  if (events.some(event => event.position === position)) return project;
  const previous = events.filter(event => event.position < position).at(-1);
  const down = previous !== undefined && previous.action !== 'stop';
  if ((action === 'start') === down) return project;
  const removed = new Set<string>();
  // Starting earlier merges with the following span; stopping earlier trims its remaining events.
  const following = events.filter(event => event.position > position);
  if (action === 'start' && following[0]?.action === 'start') removed.add(following[0].id);
  if (action === 'stop') {
    for (const event of following) {
      if (event.action === 'start') break;
      removed.add(event.id);
      if (event.action === 'stop') break;
    }
  }
  const owner = measures.find(entry => position >= entry.start && position < entry.start + entry.length)
    ?? (position === length ? measures.at(-1) : undefined);
  if (!owner) return project;
  const event: PedalEvent = { id: `pedal-${crypto.randomUUID()}`, offset: fromNumber(position - owner.start), action };
  return { ...project, outline: project.outline.map(block => {
    if (block.type !== 'measure') return block;
    const retained = (block.data.pedalEvents ?? []).filter(entry => !removed.has(entry.id));
    if (block.id === owner.measure.id) retained.push(event);
    return { ...block, data: { ...block.data, pedalEvents: retained.sort((a,b) => toNumber(a.offset) - toNumber(b.offset)) } };
  }) as ScoreProject['outline'] };
}
export function deletePedalEvent(project: ScoreProject, position: number): ScoreProject {
  const events = getPedalEvents(project);
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
  return { ...project, outline: project.outline.map(block => block.type === 'measure'
    ? { ...block, data: { ...block.data, pedalEvents: (block.data.pedalEvents ?? []).filter(event => !removed.has(event.id)) } } : block) as ScoreProject['outline'] };
}
export function getPedalSpans(project: ScoreProject, { splitAtChanges = false } = {}) {
  const spans: { start: number; end: number }[] = [];
  let start: number | undefined;
  for (const event of getPedalEvents(project)) {
    if (event.action === 'start') start = event.position;
    if (event.action === 'change' && start !== undefined && splitAtChanges) {
      spans.push({ start, end: event.position });
      start = event.position;
    }
    if (event.action === 'stop' && start !== undefined) { spans.push({ start, end: event.position }); start = undefined; }
  }
  if (start !== undefined) spans.push({ start, end: getPedalLength(project) });
  return spans;
}

/** Removing a measure also removes its events; discard resulting orphan directions. */
export function reconcilePedalOutline(outline: ScoreProject['outline']): ScoreProject['outline'] {
  let down = false;
  const valid = new Set<string>();
  for (const event of getPedalEvents({ outline })) {
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
