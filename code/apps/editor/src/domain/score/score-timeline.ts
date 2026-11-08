
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
    const notes: LocatedTimelineNote[] = [];
    let measureStartSixteenths = 0;
    for (const block of outline) {
      if (block.type !== 'measure') continue;
      const voice = block.data[staff].voices[voiceIndex];
      if (voice) for (const entry of ScoreVoice.flatten(voice, block.data.length)) {
        if (entry.element.kind === 'note') notes.push({
          note: entry.element, lengthSixteenths: entry.lengthSixteenths, tuplet: entry.tuplet, voiceIndex, measure: block, measureStartSixteenths,
          positionSixteenths: entry.positionSixteenths,
        });
      }
      measureStartSixteenths += block.data.length.cnt / block.data.length.unit * 16;
    }
    return notes;
  }
  export function allNotes(outline: readonly OutlineBlock[], staff: PianoStaffName): LocatedTimelineNote[] {
    const count = Math.max(0, ...outline.map((block) => block.type === 'measure' ? block.data[staff].voices.length : 0));
    return Array.from({ length: count }, (_, index) => notes(outline, staff, index)).flat();
  }
  export function note(outline: readonly OutlineBlock[], noteId: string, staff: PianoStaffName = 'upperStaff') {
    return allNotes(outline, staff).find(({ note }) => note.id === noteId);
  }

  export function tieChain(outline: readonly OutlineBlock[], noteId: string, staff: PianoStaffName = 'upperStaff'): LocatedTimelineNote[] {
    const voiceIndex = note(outline, noteId, staff)?.voiceIndex ?? 0;
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
