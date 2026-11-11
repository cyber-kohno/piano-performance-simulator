import type { MeasureBlock, ScoreProject, TimeSignature } from '../domain/score/types.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
import ScoreVoice from '../domain/score/score-voice.ts';
const staffNames = ['upperStaff', 'lowerStaff'] as const;
export type HeaderMeasure = { id: string; number: number; start: number; width: number };
namespace TimelineView {
  export function visualGaps(outline: ScoreProject['outline']) {
    const measures = outline.filter(block => block.type === 'measure');
    const staffNotes = staffNames.flatMap(staff => Array.from({ length: Math.max(0, ...measures.map(measure => measure.data[staff].voices.length)) }, (_, index) => ScoreTimeline.notes(outline, staff, index)));
    const gaps = new Set<string>();
    for (const notes of staffNotes) {
      for (let index = 0;index + 1 < notes.length;index += 1) {
        const current = notes[index];
        const next = notes[index + 1];
        const currentEnd = current.measureStartSixteenths + current.positionSixteenths +
          current.lengthSixteenths;
        const nextStart = next.measureStartSixteenths + next.positionSixteenths;
        const isTied = current.note.tieTo === next.note.id && next.note.tieFrom === current.note.id;
        if (Math.abs(currentEnd - nextStart) < 1e-8 && !isTied) gaps.add(current.note.id);
      }
    }
    return gaps;
  }

  export function notes(outline: ScoreProject['outline'], gapPixels: number, pixelsPerSixteenth: number) {
    const notesWithVisualGap = visualGaps(outline);
    return outline.filter(block => block.type === 'measure').map((measure) => staffNames
      .flatMap((staff) => {
        return measure.data[staff].voices.flatMap((voice, voiceIndex) => ScoreVoice.flatten(voice, measure.data.length).flatMap((entry) =>
          entry.element.kind === 'note' ? [{
            note: entry.element,
            staff,
            voiceIndex,
            position: entry.positionSixteenths,
            length: entry.lengthSixteenths,
            displayLength: entry.lengthSixteenths - (notesWithVisualGap.has(entry.element.id) ? gapPixels / pixelsPerSixteenth : 0),
          }] : [],
        ));
      }));
  }

  export function notesForMeasure(measure: MeasureBlock, notesWithVisualGap: ReadonlySet<string>, gapPixels: number, pixelsPerSixteenth: number) {
    return staffNames.flatMap((staff) => measure.data[staff].voices.flatMap((voice, voiceIndex) =>
      ScoreVoice.flatten(voice, measure.data.length).flatMap((entry) => entry.element.kind === 'note' ? [{
        note: entry.element,
        staff,
        voiceIndex,
        position: entry.positionSixteenths,
        length: entry.lengthSixteenths,
        displayLength: entry.lengthSixteenths - (notesWithVisualGap.has(entry.element.id) ? gapPixels / pixelsPerSixteenth : 0),
      }] : []),
    ));
  }

  export function layout(outline: ScoreProject['outline'], pixelsPerWhole: number): HeaderMeasure[] {
    const measures = outline.filter(block => block.type === 'measure');
    let start = 0;
    return measures.map((measure, index) => {
      const width = measure.data.length.cnt / measure.data.length.unit * pixelsPerWhole;
      const result = { id: measure.id, number: index + 1, start, width };
      start += width;
      return result;
    });
  }

  export function header(outline: ScoreProject['outline'], pixelsPerWhole: number) {
    const meter = outline[0].data.timeSignature;
    return layout(outline, pixelsPerWhole).map(measure => ({
      ...measure,
      ticks: ticks(measure, meter, pixelsPerWhole),
    }));
  }

  export function visibleMeasureIndices(
    measures: readonly HeaderMeasure[], scrollLeft: number, viewportWidth: number,
    overscan: number, requiredIndices: readonly number[] = [],
  ) {
    const result = new Set<number>();
    if (measures.length) {
      const left = Math.max(0, scrollLeft - overscan);
      const right = Math.max(left, scrollLeft + viewportWidth + overscan);
      let low = 0, high = measures.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (measures[middle].start + measures[middle].width <= left) low = middle + 1;
        else high = middle;
      }
      const first = low;
      high = measures.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (measures[middle].start < right) low = middle + 1;
        else high = middle;
      }
      for (let index = first; index < low; index += 1) result.add(index);
    }
    for (const index of requiredIndices) {
      if (Number.isInteger(index) && index >= 0 && index < measures.length) result.add(index);
    }
    return [...result].sort((left, right) => left - right);
  }

  /** Keep this window stable while scrolling within the focused measure. */
  export function focusedMeasureWindow(
    measures: readonly HeaderMeasure[], focusedIndex: number, viewportWidth: number, neighbors = 2,
  ) {
    if (!measures.length) return { indices: [] as number[], start: 0, end: 0 };
    const index = Math.max(0, Math.min(measures.length - 1, focusedIndex));
    const focus = measures[index];
    const width = Math.max(1, viewportWidth);
    // Cover every possible centered viewport within this measure, including
    // short bars on wide screens and playback traversing a long bar.
    const covering = visibleMeasureIndices(measures, focus.start, focus.width, width);
    const first = Math.min(covering[0] ?? index, Math.max(0, index - neighbors));
    const last = Math.max(covering.at(-1) ?? index, Math.min(measures.length - 1, index + neighbors));
    return {
      indices: Array.from({ length: last - first + 1 }, (_, offset) => first + offset),
      start: measures[first].start,
      end: measures[last].start + measures[last].width,
    };
  }

  export function ticks(measure: HeaderMeasure, meter: TimeSignature, pixelsPerWhole: number) {
    const isCompoundMeter = meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0;
    const beatLength = isCompoundMeter ? 3 / 8 : 1 / meter.unit;
    const sixteenthLength = 1 / 16;
    const length = measure.width / pixelsPerWhole;
    const ticks: { position: number; kind: 'bar' | 'beat' | 'eighth' | 'sixteenth' }[] = [];
    for (let division = 0; division * sixteenthLength < length - 1e-8; division += 1) {
      const notePosition = division * sixteenthLength;
      const isBeat = Math.abs(notePosition / beatLength - Math.round(notePosition / beatLength)) < 1e-8;
      const kind = division === 0 ? 'bar' : isBeat ? 'beat' : division % 2 === 0 ? 'eighth' : 'sixteenth';
      ticks.push({ position: notePosition * pixelsPerWhole, kind });
    }
    return ticks;
  }

}
export default TimelineView;
