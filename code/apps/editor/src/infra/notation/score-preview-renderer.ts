import PreviewSelection from './preview-selection.ts';
import PreviewFingerings from './preview-fingerings.ts';
import PreviewSections from './preview-sections.ts';
import PreviewPedals from './preview-pedals.ts';
import PreviewViewport from './preview-viewport.ts';
import type PreviewMusicXml from '../musicxml/preview-musicxml.ts';
export type PreviewDocument = NonNullable<ReturnType<typeof PreviewMusicXml.create>>;
namespace ScorePreviewRenderer {
  export async function render(target: HTMLDivElement, preview: PreviewDocument, signal: AbortSignal) {
    if (signal.aborted) return;
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    if (signal.aborted) return;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;width:1200px;visibility:hidden;pointer-events:none';
    target.append(stage);
    const removeStage = () => stage.remove();
    signal.addEventListener('abort', removeStage, { once: true });
    try {
      const renderer = new OpenSheetMusicDisplay(stage, {
        backend: 'svg', autoResize: false, disableCursor: true,
        drawTitle: false, drawSubtitle: false, drawComposer: false,
        drawLyricist: false, drawCredits: false, drawPartNames: false,
        drawPartAbbreviations: false, drawMeasureNumbers: true, useXMLMeasureNumbers: true,
        renderSingleHorizontalStaffline: true, autoBeam: true, alignRests: 2,
        newSystemFromXML: false, newPageFromXML: false,
      });
      renderer.setLogLevel('warn');
      renderer.EngravingRules.RenderPedals = false;
      // OSMD's default left shift causes the tempo mark to collide with the section label.
      renderer.EngravingRules.MetronomeMarkXShift = 0;
      await renderer.load(preview.xml);
      if (signal.aborted) return;
      renderer.render();
      const svg = stage.querySelector('svg');
      const measure = renderer.GraphicSheet.MeasureList[preview.activeOffset]?.[0];
      if (!svg || !measure) throw new Error('Missing rendered measure');
      const painter = PreviewSelection.createPainter(PreviewSelection.mapNotes(renderer, preview.noteTargets));
      PreviewPedals.draw(svg, renderer, preview.pedals);
      PreviewFingerings.draw(svg, renderer);
      PreviewSections.draw(svg, renderer, preview.sectionMarks);
      // OSMD positions use staff-space units; its default SVG uses ten pixels per unit.
      const box = measure.PositionAndShape;
      const left = (box.AbsolutePosition.x + box.BorderLeft) * 10;
      const width = box.Size.width * 10;
      const bounds = svg.getBBox();
      const viewportWidth = 478;
      const viewportHeight = 212;
      const view = PreviewViewport.viewBox(left, width, bounds.y, bounds.height);
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
      svg.setAttribute('width', String(viewportWidth));
      svg.setAttribute('height', String(viewportHeight));
      svg.style.display = 'block';
      const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      highlight.setAttribute('x', String(left));
      highlight.setAttribute('y', String(view.y));
      highlight.setAttribute('width', String(width));
      highlight.setAttribute('height', String(view.height));
      highlight.setAttribute('fill', '#fff3b5');
      svg.prepend(highlight);
      target.replaceChildren(svg);

      return painter;
    } finally {
      signal.removeEventListener('abort', removeStage);
      stage.remove();
    }
  }
}
export default ScorePreviewRenderer;
