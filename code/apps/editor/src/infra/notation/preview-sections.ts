type PreviewSectionMark = { measureOffset: number; name: string };
type PreviewMeasure = {
  PositionAndShape: {
    AbsolutePosition: { x: number; y: number };
    BorderLeft: number;
    BorderTop: number;
  };
};
type PreviewRenderer = { GraphicSheet: { MeasureList: (PreviewMeasure | undefined)[][] } };

namespace PreviewSections {
  export function draw(svg: SVGSVGElement, renderer: PreviewRenderer, marks: PreviewSectionMark[]) {
    const ns = 'http://www.w3.org/2000/svg';
    for (const mark of marks) {
      const measure = renderer.GraphicSheet.MeasureList[mark.measureOffset]?.[0];
      if (!measure) continue;
      const boundaryX = (measure.PositionAndShape.AbsolutePosition.x + measure.PositionAndShape.BorderLeft) * 10;
      const staffTopY = (measure.PositionAndShape.AbsolutePosition.y + measure.PositionAndShape.BorderTop) * 10;
      const group = document.createElementNS(ns, 'g');
      group.setAttribute('data-preview-section-mark', 'true');

      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(boundaryX));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'sans-serif');
      text.setAttribute('font-size', '14');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('fill', '#111');
      text.textContent = mark.name;
      group.append(text);
      svg.append(group);

      const paddingX = 4;
      const paddingY = 2;
      const textBox = text.getBBox();
      const frameHeight = textBox.height + paddingY * 2;
      const frameY = staffTopY - 20 - frameHeight;
      text.setAttribute('y', String(frameY + paddingY + textBox.height * 0.82));

      const frame = document.createElementNS(ns, 'rect');
      frame.setAttribute('data-preview-section-mark-frame', 'true');
      frame.setAttribute('x', String(boundaryX - textBox.width / 2 - paddingX));
      frame.setAttribute('y', String(frameY));
      frame.setAttribute('width', String(textBox.width + paddingX * 2));
      frame.setAttribute('height', String(frameHeight));
      frame.setAttribute('fill', '#fff');
      frame.setAttribute('stroke', '#111');
      frame.setAttribute('stroke-width', '1.5');
      group.insertBefore(frame, text);
    }
  }
}

export default PreviewSections;
