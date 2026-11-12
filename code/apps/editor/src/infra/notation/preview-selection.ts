export type PreviewNoteTarget = { noteId: string; measureOffset: number; staffIndex: number; voiceNumber: number; position: number; graceIndex?: number };
type SvgNote = {
  sourceNote?: { ParentVoiceEntry?: { IsGrace?: boolean; Timestamp?: { RealValue: number }; ParentVoice?: { VoiceId: number } } };
  getNoteheadSVGs?: () => Element[]; getStemSVG?: () => Element; getFlagSVG?: () => Element
};
type RenderedScore = { GraphicSheet: { MeasureList: ({ staffEntries: { graphicalVoiceEntries: { notes: SvgNote[] }[] }[] } | undefined)[][] } };

namespace PreviewSelection {
  /** Map performed timestamps and voices, never SVG order or pitch spelling.
   * OSMD's chord shares SVG noteheads/stem; deduplicate those elements per column.
   */
  export function mapNotes(renderer: RenderedScore, targets: PreviewNoteTarget[]): Map<string, Set<Element>> {
    const result = new Map<string, Set<Element>>();
    for (const target of targets) {
      const measure = renderer.GraphicSheet.MeasureList[target.measureOffset]?.[target.staffIndex];
      const graceEntries: object[] = [];
      for (const staffEntry of measure?.staffEntries ?? []) for (const voice of staffEntry.graphicalVoiceEntries) for (const note of voice.notes) {
        const source = note.sourceNote?.ParentVoiceEntry;
        if (!source || !!source.IsGrace !== (target.graceIndex !== undefined) || source.ParentVoice?.VoiceId !== target.voiceNumber ||
          source.Timestamp === undefined || Math.abs(source.Timestamp.RealValue * 16 - target.position) > 1e-8) continue;
        if (source.IsGrace) {
          if (!graceEntries.includes(source)) graceEntries.push(source);
          if (graceEntries.indexOf(source) !== target.graceIndex) continue;
        }
        const elements = result.get(target.noteId) ?? new Set<Element>();
        for (const element of [...(note.getNoteheadSVGs?.() ?? []), note.getStemSVG?.(), note.getFlagSVG?.()]) if (element) elements.add(element);
        result.set(target.noteId, elements);
      }
    }
    return result;
  }

  /** Color only noteheads, stems and flags. Beams/curves may be shared with unselected notes. */
  export function createPainter(notes: Map<string, Set<Element>>) {
    const originals = new Map<SVGElement, { fill: string; stroke: string; fillPriority: string; strokePriority: string; paintFill: boolean; paintStroke: boolean }>();
    for (const elements of notes.values()) for (const element of elements) {
      for (const leaf of [element, ...element.querySelectorAll('path, rect, ellipse, polygon, line, use')]) {
        const svg = leaf as SVGElement;
        if (originals.has(svg)) continue;
        const computed = getComputedStyle(svg);
        originals.set(svg, {
          fill: svg.style.getPropertyValue('fill'), stroke: svg.style.getPropertyValue('stroke'),
          fillPriority: svg.style.getPropertyPriority('fill'), strokePriority: svg.style.getPropertyPriority('stroke'),
          paintFill: computed.fill !== 'none', paintStroke: computed.stroke !== 'none'
        });
      }
    }
    const leaves = new Map<string, Set<SVGElement>>();
    for (const [id, elements] of notes) {
      const set = new Set<SVGElement>();
      for (const element of elements) for (const leaf of [element, ...element.querySelectorAll('path, rect, ellipse, polygon, line, use')]) set.add(leaf as SVGElement);
      leaves.set(id, set);
    }
    let active = new Map<SVGElement, string>();
    let previousIds = new Set<string>(), previousColor = '';
    return (selectedIds: readonly string[], overrideColor?: string) => {
      const ids = new Set(selectedIds);
      const color = overrideColor ?? (selectedIds.length > 1 ? '#c62828' : '#1565c0');
      if (color === previousColor && ids.size === previousIds.size && [...ids].every(id => previousIds.has(id))) return;
      previousIds = ids; previousColor = color;
      const next = new Map<SVGElement, string>();
      for (const id of ids) for (const leaf of leaves.get(id) ?? []) next.set(leaf, color);
      for (const svg of active.keys()) if (!next.has(svg)) {
        const original = originals.get(svg)!;
        for (const property of ['fill', 'stroke'] as const) {
          if (original[property]) svg.style.setProperty(property, original[property], original[property === 'fill' ? 'fillPriority' : 'strokePriority']);
          else svg.style.removeProperty(property);
        }
      }
      for (const [svg, value] of next) if (active.get(svg) !== value) {
        const original = originals.get(svg)!;
        if (original.paintFill) svg.style.setProperty('fill', value, 'important');
        if (original.paintStroke) svg.style.setProperty('stroke', value, 'important');
      }
      active = next;
    };
  }

}
export default PreviewSelection;
