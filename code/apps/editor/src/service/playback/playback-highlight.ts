import type { PlaybackEvent } from '../../domain/performance/score-playback-plan.ts';

/** Incremental note-on/off index. Pedal/reverb never extend a written note's highlight. */
export function createPlaybackHighlight(events: readonly PlaybackEvent[]) {
  const edges = events.flatMap(event => {
    const end = event.startSeconds + Math.max(...(event.pitchDurationsSeconds ?? [event.durationSeconds]));
    const ranges = event.notationRanges ?? (event.notationNoteIds ?? [event.sourceNoteId]).map(noteId => ({ noteId, startSeconds: event.startSeconds, endSeconds: end }));
    return ranges.flatMap(range => {
      const start = Math.max(event.startSeconds, range.startSeconds), stop = Math.min(end, range.endSeconds ?? end);
      return stop > start ? [{ time: start, id: range.noteId, delta: 1 }, { time: stop, id: range.noteId, delta: -1 }] : [];
    });
  }).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let index = 0, previous = -1;
  const counts = new Map<string, number>();
  let ids: readonly string[] = [];
  return (time: number): readonly string[] => {
    if (time < previous) { index = 0; counts.clear(); }
    previous = time;
    while (index < edges.length && edges[index].time <= time) {
      const edge = edges[index++], count = (counts.get(edge.id) ?? 0) + edge.delta;
      if (count > 0) counts.set(edge.id, count); else counts.delete(edge.id);
    }
    const next = [...counts.keys()];
    if (next.length !== ids.length || next.some(id => !ids.includes(id))) ids = next;
    return ids;
  };
}
