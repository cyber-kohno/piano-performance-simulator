namespace PreviewViewport {
  export function viewBox(left: number, width: number, top: number, height: number) {
    const viewWidth = Math.max(width * 2, (height + 24) * 478 / 212);
    const viewHeight = viewWidth * 212 / 478;
    return {
      x: left + width / 2 - viewWidth / 2, y: top + height / 2 - viewHeight / 2,
      width: viewWidth, height: viewHeight,
    };
  }

}
export default PreviewViewport;
