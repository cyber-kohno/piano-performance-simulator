import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { PreviewPedalEvent } from './score-preview.ts';

export type PedalLayoutMeasure = {
  length: number;
  startX: number;
  endX: number;
  anchors: { position: number; x: number }[];
};

/** Interpolate musical time between OSMD's actual spacing anchors, not bar-width ratios. */
export function getPedalPreviewX(measure: PedalLayoutMeasure, position: number): number {
  const byTime = new Map<number, number>([[0, measure.startX], [measure.length, measure.endX]]);
  for (const anchor of measure.anchors) {
    if (anchor.position >= 0 && anchor.position < measure.length) byTime.set(anchor.position, anchor.x);
  }
  const anchors = [...byTime].map(([position, x]) => ({ position, x })).sort((a, b) => a.position - b.position);
  const time = Math.max(0, Math.min(measure.length, position));
  const next = anchors.findIndex(anchor => anchor.position >= time);
  if (next <= 0) return anchors[0].x;
  const left = anchors[next - 1], right = anchors[next];
  return left.x + (right.x - left.x) * (time - left.position) / (right.position - left.position);
}

export function getPedalPreviewPaths(events: PreviewPedalEvent[], measures: PedalLayoutMeasure[], y: number) {
  const paths: string[] = [];
  let path = '';
  for (const event of events) {
    const measure = measures[event.measureOffset];
    if (!measure) continue;
    const x = getPedalPreviewX(measure, event.position);
    if (event.type === 'start' || event.type === 'resume') {
      path = event.type === 'start' ? `M ${x} ${y - 7} L ${x} ${y}` : `M ${x} ${y}`;
    } else if (event.type === 'change' && path) {
      path += ` L ${x - 4} ${y} L ${x} ${y - 7} L ${x + 4} ${y}`;
    } else if (path) {
      path += ` L ${x} ${y}`;
      if (event.type === 'stop') path += ` L ${x} ${y - 7}`;
      paths.push(path);
      path = '';
    }
  }
  return paths;
}

/** OSMD 2.2.1 ties pedal graphics to nearby noteheads and ignores pedal offsets.
 * Keep standard MusicXML, but draw this independent-time overlay using its score geometry.
 * No hidden notes or changed rest spelling are inserted into the score.
 */
export function drawPreviewPedals(svg: SVGSVGElement, renderer: OpenSheetMusicDisplay, events: PreviewPedalEvent[]) {
  if (events.length === 0) return;
  const measures: PedalLayoutMeasure[] = renderer.GraphicSheet.MeasureList.map(column => {
    const lower = column[1] ?? column[0];
    const left = lower.PositionAndShape.AbsolutePosition.x * 10;
    const startX = left + lower.beginInstructionsWidth * 10 + 5;
    const endX = left + lower.PositionAndShape.Size.width * 10 - lower.endInstructionsWidth * 10 - 2;
    const anchors = new Map<number, number>();
    for (const staff of column) for (const entry of staff.staffEntries) {
      // A centered full-measure rest does not identify the beginning of musical time.
      if (entry.graphicalVoiceEntries.every(voice => voice.notes.every(note => note.sourceNote.isRest() && note.sourceNote.isWholeMeasureNote()))) continue;
      const position = entry.relInMeasureTimestamp.RealValue * 16;
      const x = Math.max(startX, Math.min(endX, entry.PositionAndShape.AbsolutePosition.x * 10));
      anchors.set(position, Math.min(anchors.get(position) ?? x, x));
    }
    return { length: lower.parentSourceMeasure.Duration.RealValue * 16, startX, endX,
      anchors: [...anchors].map(([position, x]) => ({ position, x })) };
  });
  const bounds = svg.getBBox();
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'score-preview-pedals');
  group.setAttribute('aria-label', 'Damper pedal');
  for (const d of getPedalPreviewPaths(events, measures, bounds.y + bounds.height + 16)) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#000');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');
    group.append(path);
  }
  svg.append(group);
}
