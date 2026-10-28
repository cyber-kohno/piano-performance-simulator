import { lcm } from './rational.ts';
import { getFlattenedVoiceElements, type KeySignature, type PianoPitch, type ScoreProject } from './project.ts';

export function getScorePreviewViewBox(left: number, width: number, top: number, height: number) {
  const viewWidth = Math.max(width * 2, (height + 24) * 478 / 212);
  const viewHeight = viewWidth * 212 / 478;
  return {
    x: left + width / 2 - viewWidth / 2, y: top + height / 2 - viewHeight / 2,
    width: viewWidth, height: viewHeight,
  };
}

/** Preview-only spelling. User-controlled enharmonic spelling is still a separate domain task. */
export function spellPreviewPitch(midi: number, key: KeySignature) {
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const naturals = [0, 2, 4, 5, 7, 9, 11];
  const order = key.fifths >= 0 ? [3, 0, 4, 1, 5, 2, 6] : [6, 2, 5, 1, 4, 0, 3];
  const keyAlter = naturals.map((_, index) => order.slice(0, Math.abs(key.fifths)).includes(index) ? Math.sign(key.fifths) : 0);
  const candidates = naturals.flatMap((natural, index) => [-2, -1, 0, 1, 2].flatMap((alter) => {
    const octave = (midi - natural - alter) / 12 - 1;
    return Number.isInteger(octave) ? [{
      step: steps[index], alter, octave,
      cost: Math.abs(alter - keyAlter[index]) * 10 + Math.abs(alter) +
        (alter !== 0 && Math.sign(alter) !== (key.fifths < 0 ? -1 : 1) ? 1 : 0),
    }] : [];
  }));
  return candidates.sort((a, b) => a.cost - b.cost)[0];
}

export function createScorePreview(outline: ScoreProject['outline'], activeIndex: number) {
  const measures = outline.filter((block) => block.type === 'measure');
  if (activeIndex < 0 || activeIndex >= measures.length) return null;
  const firstIndex = Math.max(0, activeIndex - 1);
  const visible = measures.slice(firstIndex, activeIndex + 2);
  const visibleIds = new Set(visible.flatMap((measure) => [measure.data.upperStaff, measure.data.lowerStaff]
    .flatMap((staff) => staff.voices.flatMap((voice) => getFlattenedVoiceElements(voice, measure.data.length).map(({ element }) => element.id)))));
  const initial = outline[0].data;
  const ticksPerSixteenth = visible.reduce((resolution, measure) => [measure.data.upperStaff, measure.data.lowerStaff].reduce((staffResolution, staff) =>
    staff.voices.reduce((voiceResolution, voice) => getFlattenedVoiceElements(voice, measure.data.length).reduce((value, entry) => lcm(value, entry.lengthTime.denominator), voiceResolution), staffResolution), resolution), 2);
  const pitchXml = (pitch: PianoPitch) => {
    const spelling = spellPreviewPitch(pitch.midi, initial.keySignature);
    return `<pitch><step>${spelling.step}</step><alter>${spelling.alter}</alter><octave>${spelling.octave}</octave></pitch>`;
  };
  const content = visible.map((measure, index) => {
    const length = measure.data.length.cnt / measure.data.length.unit * 16;
    const irregular = length !== initial.timeSignature.cnt / initial.timeSignature.unit * 16;
    let body = index === 0 ? `<attributes><divisions>${ticksPerSixteenth * 4}</divisions><key><fifths>${initial.keySignature.fifths}</fifths></key>` +
      `<time><beats>${initial.timeSignature.cnt}</beats><beat-type>${initial.timeSignature.unit}</beat-type></time>` +
      '<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : '';
    let voiceCount = 0;
    [measure.data.upperStaff, measure.data.lowerStaff].forEach((staff, staffIndex) => staff.voices.forEach((voice, voiceIndex) => {
      if (voiceCount++ > 0) body += `<backup><duration>${length * ticksPerSixteenth}</duration></backup>`;
      const voiceNumber = staffIndex * 3 + voiceIndex + 1;
      for (const entry of getFlattenedVoiceElements(voice, measure.data.length)) {
        const { element, tuplet, childIndex } = entry;
        const duration = entry.lengthTime.numerator * (ticksPerSixteenth / entry.lengthTime.denominator);
        const written = element.kind === 'measure-rest' ? '' : `<type>${element.value.type}</type>${'<dot/>'.repeat(element.value.dots)}`;
        const modification = tuplet ? '<time-modification><actual-notes>' + tuplet.actual + '</actual-notes><normal-notes>' + tuplet.normal + '</normal-notes><normal-type>' + tuplet.baseType + '</normal-type></time-modification>' : '';
        const bracket = tuplet ? (childIndex === 0 ? '<tuplet type="start" bracket="yes"/>' : '') + (childIndex === tuplet.elements.length - 1 ? '<tuplet type="stop"/>' : '') : '';
        if (element.kind !== 'note') {
          body += `<note>${element.kind === 'measure-rest' ? '<rest measure="yes"/>' : '<rest/>'}<duration>${duration}</duration><voice>${voiceNumber}</voice>${written}${modification}<staff>${staffIndex + 1}</staff>${bracket ? `<notations>${bracket}</notations>` : ''}</note>`;
          continue;
        }
        const from = element.tieFrom !== undefined && visibleIds.has(element.tieFrom);
        const to = element.tieTo !== undefined && visibleIds.has(element.tieTo);
        element.pitches.forEach((pitch, pitchIndex) => {
          const ties = `${from ? '<tie type="stop"/>' : ''}${to ? '<tie type="start"/>' : ''}`;
          const notations = (pitchIndex === 0 ? bracket : '') + `${from ? '<tied type="stop"/>' : ''}${to ? '<tied type="start"/>' : ''}` +
            (pitch.fingering ? `<technical><fingering>${pitch.fingering}</fingering></technical>` : '');
          body += `<note>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch)}<duration>${duration}</duration>${ties}<voice>${voiceNumber}</voice>${written}${modification}` +
            (staff.voices.length > 1 ? `<stem>${voiceIndex % 2 === 0 ? 'up' : 'down'}</stem>` : '') +
            `<staff>${staffIndex + 1}</staff>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
        });
      }
    }));
    return `<measure number="${firstIndex + index + 1}"${irregular ? ' implicit="yes"' : ''}>${body}</measure>`;
  }).join('');
  return {
    activeOffset: activeIndex - firstIndex,
    xml: '<?xml version="1.0" encoding="UTF-8"?>' +
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
      `<part id="P1">${content}</part></score-partwise>`,
  };
}
