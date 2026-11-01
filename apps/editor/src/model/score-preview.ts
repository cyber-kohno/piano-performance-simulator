import { spellPreviewPitch } from './pitch-spelling.ts';
import { getTrillChain, getTrillAuxiliary } from './trill.ts';
import { compare, lcm, rational, toNumber } from './rational.ts';
import { getFlattenedVoiceElements, type KeySignature, type PedalEvent, type PianoPitch, type ScoreProject } from './project.ts';

export type PreviewPedalEvent = {
  measureOffset: number;
  position: number;
  type: PedalEvent['action'] | 'resume' | 'discontinue';
};

export function getScorePreviewViewBox(left: number, width: number, top: number, height: number) {
  const viewWidth = Math.max(width * 2, (height + 24) * 478 / 212);
  const viewHeight = viewWidth * 212 / 478;
  return {
    x: left + width / 2 - viewWidth / 2, y: top + height / 2 - viewHeight / 2,
    width: viewWidth, height: viewHeight,
  };
}

export { spellPreviewPitch } from './pitch-spelling.ts';

export function createScorePreview(outline: ScoreProject['outline'], activeIndex: number, trills: ScoreProject['trills'] = []) {
  const measures = outline.filter((block) => block.type === 'measure');
  if (activeIndex < 0 || activeIndex >= measures.length) return null;
  const firstIndex = Math.max(0, activeIndex - 1);
  const visible = measures.slice(firstIndex, activeIndex + 2);
  const visibleIds = new Set(visible.flatMap((measure) => [measure.data.upperStaff, measure.data.lowerStaff]
    .flatMap((staff) => staff.voices.flatMap((voice) => getFlattenedVoiceElements(voice, measure.data.length).map(({ element }) => element.id)))));
  const initial = outline[0].data;
  const trillByNote = new Map<string, string>();
  for(const span of trills) {
    const chain=getTrillChain({outline},span.startNoteId);
    if(chain.at(-1)?.id!==span.endNoteId || !chain.every(note=>note.pitches.length===1)) continue;
    const clipped=chain.filter(note=>visibleIds.has(note.id));
    const auxiliary=getTrillAuxiliary(chain[0].pitches[0].midi,initial.keySignature,span.settings.auxiliary);
    const keyAux=getTrillAuxiliary(chain[0].pitches[0].midi,initial.keySignature,'diatonic');
    const accidental=auxiliary.alter!==keyAux.alter ? ['flat-flat','flat','natural','sharp','double-sharp'][auxiliary.alter+2] : undefined;
    clipped.forEach((note,index)=>{
      const start=index===0, stop=index===clipped.length-1;
      const sound=' start-note="'+(span.settings.start==='main'?'main':'upper')+'" beats="'+span.settings.attackCount+'" trill-step="'+(auxiliary.midi-chain[0].pitches[0].midi===1?'half':'whole')+'"';
      const ornament=(start ? '<trill-mark'+sound+'/>' : '')+
        (start ? '<wavy-line type="start" number="1"/>' : '')+
        (!start && !stop ? '<wavy-line type="continue" number="1"/>' : '')+
        (stop ? '<wavy-line type="stop" number="1"/>' : '')+
        (start && accidental ? '<accidental-mark placement="above">'+accidental+'</accidental-mark>' : '');
      trillByNote.set(note.id,ornament);
    });
  }
  const noteResolution = visible.reduce((resolution, measure) => [measure.data.upperStaff, measure.data.lowerStaff].reduce((staffResolution, staff) =>
    staff.voices.reduce((voiceResolution, voice) => getFlattenedVoiceElements(voice, measure.data.length).reduce((value, entry) => lcm(value, entry.lengthTime.denominator), voiceResolution), staffResolution), resolution), 2);
  const ticksPerSixteenth = visible.reduce((resolution, measure) =>
    (measure.data.pedalEvents ?? []).reduce((value, event) => lcm(value, event.offset.denominator), resolution), noteResolution);
  // A preview is only a window into the score. Reconstruct its incoming pedal state
  // without inserting events into the saved project.
  let pedalDown = false;
  const pedals: PreviewPedalEvent[] = [];
  for (const measure of measures.slice(0, firstIndex)) {
    for (const event of [...(measure.data.pedalEvents ?? [])].sort((a, b) => compare(a.offset, b.offset))) {
      pedalDown = event.action !== 'stop';
    }
  }
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
    const pedalEvents: { offset: PedalEvent['offset']; type: PreviewPedalEvent['type'] }[] = [...(measure.data.pedalEvents ?? [])]
      .sort((a, b) => compare(a.offset, b.offset)).map(event => ({ offset: event.offset, type: event.action }));
    if (index === 0 && pedalDown) {
      if (pedalEvents[0] && compare(pedalEvents[0].offset, rational(0)) === 0) {
        // At the left boundary a release has no visible span; a retake resumes it.
        if (pedalEvents[0].type === 'stop') { pedalEvents.shift(); pedalDown = false; }
        else pedalEvents[0] = { ...pedalEvents[0], type: 'resume' };
      } else pedalEvents.unshift({ offset: rational(0), type: 'resume' });
    }
    for (const event of pedalEvents) {
      body += `<direction placement="below"><direction-type><pedal type="${event.type}" line="yes" sign="no" number="1"/></direction-type><offset>${event.offset.numerator * (ticksPerSixteenth / event.offset.denominator)}</offset><staff>2</staff></direction>`;
      pedals.push({ measureOffset: index, position: toNumber(event.offset), type: event.type });
      pedalDown = event.type !== 'stop';
    }
    if (index === visible.length - 1 && pedalDown) {
      // A clipped/open line has no release hook. This is presentation only.
      body += `<direction placement="below"><direction-type><pedal type="discontinue" line="yes" sign="no" number="1"/></direction-type><offset>${length * ticksPerSixteenth}</offset><staff>2</staff></direction>`;
      pedals.push({ measureOffset: index, position: length, type: 'discontinue' });
    }
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
        for (const grace of element.beforeGraceNotes ?? []) {
          grace.pitches.forEach((pitch, pitchIndex) => {
            const fingering = pitch.fingering ? `<notations><technical><fingering>${pitch.fingering}</fingering></technical></notations>` : '';
            body += `<note><grace slash="${grace.slash ? 'yes' : 'no'}"/>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch)}` +
              `<voice>${voiceNumber}</voice><type>${grace.value.type}</type>${'<dot/>'.repeat(grace.value.dots)}<staff>${staffIndex + 1}</staff>${fingering}</note>`;
          });
        }
        const from = element.tieFrom !== undefined && visibleIds.has(element.tieFrom);
        const to = element.tieTo !== undefined && visibleIds.has(element.tieTo);
        element.pitches.forEach((pitch, pitchIndex) => {
          const ties = `${from ? '<tie type="stop"/>' : ''}${to ? '<tie type="start"/>' : ''}`;
          const notations = (pitchIndex === 0 ? bracket : '') +
            (pitchIndex === 0 && trillByNote.has(element.id) ? '<ornaments>'+trillByNote.get(element.id)!.replaceAll('number="1"','number="'+voiceNumber+'"')+'</ornaments>' : '') + `${from ? '<tied type="stop"/>' : ''}${to ? '<tied type="start"/>' : ''}` +
            (pitchIndex === 0 && element.staccato ? `<articulations><${element.staccato.type === 'normal' ? 'staccato' : 'staccatissimo'}/></articulations>` : '') +
            (element.arpeggio ? `<arpeggiate number="${voiceNumber}"${element.arpeggio.type === 'down' ? ' direction="down"' : ''}/>` : '') +
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
    pedals,
    xml: '<?xml version="1.0" encoding="UTF-8"?>' +
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
      `<part id="P1">${content}</part></score-partwise>`,
  };
}
