type PreviewRenderer = {
  GraphicSheet: {
    MeasureList: ({ staffEntries?: { FingeringEntries?: GraphicalLabel[] }[] } | undefined)[][];
  };
};

type GraphicalLabel = {
  sourceNote?: object;
  TextLines?: { text: string }[];
  Label?: { text?: string };
  SVGNode?: Node;
  PositionAndShape?: {
    AbsolutePosition?: { x: number; y: number };
    Size?: { width: number; height: number };
  };
};

namespace PreviewFingerings {
  /** Replace OSMD's vertically stacked substitution labels with a compact paired label. */
  export function draw(svg: SVGSVGElement, renderer: PreviewRenderer) {
    const labelsByNote = new Map<object, GraphicalLabel[]>();
    for (const measure of renderer.GraphicSheet.MeasureList) {
      for (const staff of measure ?? []) for (const entry of staff?.staffEntries ?? []) {
        for (const label of entry.FingeringEntries ?? []) {
          if (!label.sourceNote) continue;
          const labels = labelsByNote.get(label.sourceNote) ?? [];
          labels.push(label);
          labelsByNote.set(label.sourceNote, labels);
        }
      }
    }

    const ns = 'http://www.w3.org/2000/svg';
    for (const labels of labelsByNote.values()) {
      if (labels.length !== 2) continue;
      const values = labels.map(label => label.TextLines?.map(line => line.text).join('') ?? label.Label?.text ?? '');
      if (!values.every(value => /^[1-5]$/.test(value))) continue;
      const boxes = labels.map(label => {
        const position = label.PositionAndShape?.AbsolutePosition;
        const size = label.PositionAndShape?.Size;
        return position && size ? { x: position.x, y: position.y, width: size.width, height: size.height } : undefined;
      });
      if (!boxes[0] || !boxes[1]) continue;

      // Keep OSMD's original labels in the layout calculation, but hide their stacked rendering.
      for (const label of labels) {
        const node = label.SVGNode as SVGElement | undefined;
        node?.setAttribute('visibility', 'hidden');
      }

      const group = document.createElementNS(ns, 'g');
      group.setAttribute('data-preview-fingering-substitution', 'true');
      group.setAttribute('fill', '#111');
      group.setAttribute('stroke', 'none');
      const centerX = ((boxes[0].x + boxes[0].width / 2) + (boxes[1].x + boxes[1].width / 2)) / 2 * 10;
      const baselineY = ((boxes[0].y + boxes[0].height / 2) + (boxes[1].y + boxes[1].height / 2)) / 2 * 10 + 3;
      const gap = 5.5;
      const left = centerX - gap;
      const right = centerX + gap;
      const digit = (value: string, x: number) => {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(baselineY));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('font-family', 'serif');
        text.setAttribute('font-size', '9');
        text.textContent = value;
        return text;
      };
      const curve = document.createElementNS(ns, 'path');
      curve.setAttribute('d', `M ${left} ${baselineY - 5} Q ${centerX} ${baselineY - 11} ${right} ${baselineY - 5}`);
      curve.setAttribute('fill', 'none');
      curve.setAttribute('stroke', '#111');
      curve.setAttribute('stroke-width', '0.8');
      group.append(curve, digit(values[0], left), digit(values[1], right));
      svg.append(group);
    }
  }
}

export default PreviewFingerings;
