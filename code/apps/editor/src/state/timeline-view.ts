import type { ScoreProject } from '../domain/score/types.ts';
import ScoreTimeline from '../domain/score/score-timeline.ts';
import ScoreVoice from '../domain/score/score-voice.ts';
const staffNames = ['upperStaff', 'lowerStaff'] as const;
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

  export function header(outline: ScoreProject['outline'], pixelsPerWhole: number) {
    const measures = outline.filter(block => block.type === 'measure');
    const meter = outline[0].data.timeSignature;
    const isCompoundMeter = meter.unit === 8 && meter.cnt >= 6 && meter.cnt % 3 === 0;
    const beatLength = isCompoundMeter ? 3 / 8 : 1 / meter.unit;
    const sixteenthLength = 1 / 16;

    return measures.map((measure, index) => {
      const length = measure.data.length.cnt / measure.data.length.unit;
      const width = length * pixelsPerWhole;
      const ticks: { position: number; kind: 'bar' | 'beat' | 'eighth' | 'sixteenth' }[] = [];

      for (let division = 0;division * sixteenthLength < length - 1e-8;division += 1) {
        const notePosition = division * sixteenthLength;
        const isBeat = Math.abs(notePosition / beatLength - Math.round(notePosition / beatLength)) < 1e-8;
        const kind = division === 0
          ? 'bar'
          : isBeat
            ? 'beat'
            : division % 2 === 0
              ? 'eighth'
              : 'sixteenth';
        ticks.push({ position: notePosition * pixelsPerWhole, kind });
      }

      return { id: measure.id, number: index + 1, width, ticks };
    });
  }

}
export default TimelineView;
