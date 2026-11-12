
import ScoreVoice from "./score-voice.ts";
import type { OutlineBlock, PianoStaffName, PianoNote, PianoTuplet, MeasureBlock } from './types.ts';

export type LocatedTimelineNote = {
  note: PianoNote;
  /** Performed duration; the note value itself remains its written duration. */
  lengthSixteenths: number;
  tuplet?: PianoTuplet;
  voiceIndex: number;
  measure: MeasureBlock;
  measureStartSixteenths: number;
  /** Derived by summing preceding voice elements, not saved on the note. */
  positionSixteenths: number;
};

namespace ScoreTimeline {
  // Opt in only for immutable editor revisions; mutable drafts stay uncached.
  const immutable = new WeakSet<readonly OutlineBlock[]>();
  const noteCache = new WeakMap<readonly OutlineBlock[], Map<string, LocatedTimelineNote[]>>();
  const idCache = new WeakMap<readonly OutlineBlock[], Map<string, LocatedTimelineNote>>();
  const measureNotes = new WeakMap<MeasureBlock, Map<string, { start: number; notes: LocatedTimelineNote[] }>>();
  const indexCache = new WeakMap<readonly OutlineBlock[], ReturnType<typeof buildIndex>>();
  const timingKeys = new WeakMap<readonly OutlineBlock[], object>();
  export function prepare(outline: readonly OutlineBlock[], source?: readonly OutlineBlock[]) {
    immutable.add(outline);
    if (!timingKeys.has(outline)) timingKeys.set(outline, (source && timingKeys.get(source)) || {});
  }
  export function timingKey(outline: readonly OutlineBlock[]) { return timingKeys.get(outline); }
  /** Only use for edits that leave IDs, durations and tie connections unchanged. */
  export function inheritTiming(before: readonly OutlineBlock[], after: readonly OutlineBlock[]) {
    if (immutable.has(before)) prepare(after, before);
  }
  export function isPrepared(outline: readonly OutlineBlock[]) { return immutable.has(outline); }
  // Build once per outline revision; transport updates only search this index.
  export function index(outline: readonly OutlineBlock[]) {
    const cached = indexCache.get(outline);
    if (cached) return cached;
    const result = buildIndex(outline);
    if (immutable.has(outline)) indexCache.set(outline, result);
    return result;
  }
  function buildIndex(outline: readonly OutlineBlock[]) {
    const measures: { measure: MeasureBlock; startSixteenths: number; lengthSixteenths: number; index: number }[] = [];
    const blockPositions = new Map<string, number>();
    let length = 0;
    let lastSection: OutlineBlock | undefined;
    for (const block of outline) {
      blockPositions.set(block.id, length);
      if (block.type === 'section') lastSection = block;
      if (block.type !== 'measure') continue;
      const lengthSixteenths = block.data.length.cnt / block.data.length.unit * 16;
      measures.push({ measure: block, startSixteenths: length, lengthSixteenths, index: measures.length });
      length += lengthSixteenths;
    }
    const measureAt = (position: number) => {
      let low = 0, high = measures.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (measures[middle].startSixteenths + measures[middle].lengthSixteenths <= position) low = middle + 1;
        else high = middle;
      }
      const entry = measures[low];
      return entry && position >= entry.startSixteenths && position < entry.startSixteenths + entry.lengthSixteenths ? entry : undefined;
    };
    return { length, blockPositions, measureAt, blockAt: (position: number) => measureAt(position)?.measure ?? lastSection };
  }

  export function length(outline: readonly OutlineBlock[]): number {
    return outline.reduce((sum, block) => sum + (block.type === 'measure' ? block.data.length.cnt / block.data.length.unit * 16 : 0), 0);
  }
  export function measureAt(outline: readonly OutlineBlock[], position: number) {
    let startSixteenths = 0;
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      const lengthSixteenths = block.data.length.cnt / block.data.length.unit * 16;
      // Playback positions are approximate decimals from the transport's binary search.
      if (position >= startSixteenths && position < startSixteenths + lengthSixteenths) {
        return { measure: block, startSixteenths, lengthSixteenths };
      }
      startSixteenths += lengthSixteenths;
    }
    return undefined;
  }
  export function notes(
    outline: readonly OutlineBlock[], staff: PianoStaffName = 'upperStaff', voiceIndex = 0,
  ): LocatedTimelineNote[] {
    const key = `${staff}:${voiceIndex}`;
    const cache = immutable.has(outline) ? noteCache.get(outline) ?? new Map<string, LocatedTimelineNote[]>() : undefined;
    if (cache?.has(key)) return cache.get(key)!;
    const notes: LocatedTimelineNote[] = [];
    let measureStartSixteenths = 0;
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      const voice = block.data[staff].voices[voiceIndex];
      const cached = cache ? measureNotes.get(block)?.get(key) : undefined;
      if (cached && cached.start === measureStartSixteenths) notes.push(...cached.notes);
      else if (voice) {
        const local: LocatedTimelineNote[] = [];
        for (const entry of ScoreVoice.flatten(voice, block.data.length)) {
          if (entry.element.kind === 'note') local.push({
            note: entry.element, lengthSixteenths: entry.lengthSixteenths, tuplet: entry.tuplet, voiceIndex, measure: block, measureStartSixteenths,
            positionSixteenths: entry.positionSixteenths,
          });
        }
        notes.push(...local);
        if (cache) {
          const entries = measureNotes.get(block) ?? new Map();
          entries.set(key, { start: measureStartSixteenths, notes: local });
          measureNotes.set(block, entries);
        }
      }
      measureStartSixteenths += block.data.length.cnt / block.data.length.unit * 16;
    }
    if (cache) { cache.set(key, notes); noteCache.set(outline, cache); }
    return notes;
  }
  export function allNotes(outline: readonly OutlineBlock[], staff: PianoStaffName): LocatedTimelineNote[] {
    const count = Math.max(0, ...outline.map((block) => block.type === 'measure' ? block.data[staff].voices.length : 0));
    return Array.from({ length: count }, (_, index) => notes(outline, staff, index)).flat();
  }
  export function note(outline: readonly OutlineBlock[], noteId: string, staff: PianoStaffName = 'upperStaff') {
    if (immutable.has(outline)) {
      let byId = idCache.get(outline);
      if (!byId) {
        byId = new Map();
        for (const name of ['upperStaff', 'lowerStaff'] as const) {
          for (const entry of allNotes(outline, name)) byId.set(`${name}:${entry.note.id}`, entry);
        }
        idCache.set(outline, byId);
      }
      return byId.get(`${staff}:${noteId}`);
    }
    return allNotes(outline, staff).find(({ note }) => note.id === noteId);
  }

  export function tieChain(outline: readonly OutlineBlock[], noteId: string, staff: PianoStaffName = 'upperStaff'): LocatedTimelineNote[] {
    const selected = note(outline, noteId, staff);
    if (!selected) return [];
    if (!selected.note.tieFrom && !selected.note.tieTo) return [selected];
    const voiceIndex = selected.voiceIndex;
    const byId = new Map(notes(outline, staff, voiceIndex).map((entry) => [entry.note.id, entry]));
    let head = byId.get(noteId);
    if (!head) return [];
    const visited = new Set([head.note.id]);
    while (head.note.tieFrom) {
      const previous = byId.get(head.note.tieFrom);
      if (!previous || previous.note.tieTo !== head.note.id || visited.has(previous.note.id)) break;
      visited.add(previous.note.id);
      head = previous;
    }
    const result: LocatedTimelineNote[] = [];
    visited.clear();
    let current: LocatedTimelineNote | undefined = head;
    while (current && !visited.has(current.note.id)) {
      result.push(current);
      visited.add(current.note.id);
      const next: LocatedTimelineNote | undefined = current.note.tieTo ? byId.get(current.note.tieTo) : undefined;
      current = next?.note.tieFrom === current.note.id ? next : undefined;
    }
    return result;
  }

  export function outlinePosition(outline: readonly OutlineBlock[], blockId: string): number {
    let position = 0;
    for (const block of outline) {
      if (block.id === blockId) return position;
      if (block.type === 'measure') position += block.data.length.cnt / block.data.length.unit * 16;
    }
    return position;
  }
  export function blockAt(outline: readonly OutlineBlock[], position: number): OutlineBlock | undefined {
    let start = 0;
    let lastSection: OutlineBlock | undefined;
    for (const block of outline) {
      if (block.type === 'section') { lastSection = block; continue; }
      if (block.type !== 'measure') continue;
      const length = block.data.length.cnt / block.data.length.unit * 16;
      if (position >= start && position < start + length) return block;
      start += length;
    }
    return lastSection;
  }

}
export default ScoreTimeline;
