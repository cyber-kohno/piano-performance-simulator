
import TrillPitch from "../../domain/theory/trill-pitch.ts";

import ScoreTrill from "../../domain/score/score-trill.ts";

import ScoreClef from "../../domain/score/score-clef.ts";

import ScoreTempo from "../../domain/score/score-tempo.ts";
import ScoreDynamics from "../../domain/score/score-dynamics.ts";

import ScoreSlur from "../../domain/score/score-slur.ts";

import PitchSpelling from "../../domain/theory/pitch-spelling.ts";

import ScoreVoice from "../../domain/score/score-voice.ts";
import MusicalTime from "../../domain/theory/musical-time.ts";
import Meter from "../../domain/theory/meter.ts";
import ScoreKey from "../../domain/score/score-key.ts";
import ScoreOttava from "../../domain/score/score-ottava.ts";

import { type Clef } from "../../domain/score/score-clef.ts";

import { type KeySignature, type PedalEvent, type PianoPitch, type PianoStaffName, type ScoreProject } from "../../domain/score/types.ts";
import type { OutlineBlock } from "../../domain/score/types.ts";

export type PreviewPedalEvent = {
  measureOffset: number;
  position: number;
  type: PedalEvent['action'] | 'resume' | 'discontinue';
};
export type PreviewOttavaEvent = { measureOffset: number; position: number; staff: PianoStaffName; type: 'up' | 'down' | 'stop' };

namespace PreviewMusicXml {
  export const spellPitch = PitchSpelling.forPreview;

  function sectionMarkers(outline: OutlineBlock[]) {
    const markers = new Map<string, { name: string; doubleBarline: boolean }>();
    let sectionIndex = -1;
    let pending: { name: string; index: number }[] = [];
    for (const block of outline) {
      if (block.type === 'section') {
        sectionIndex += 1;
        pending.push({ name: block.data.name, index: sectionIndex });
      } else if (block.type === 'measure' && pending.length) {
        // Empty adjacent sections share a score position. Keep the earliest one.
        const section = pending[0];
        markers.set(block.id, { name: section.name, doubleBarline: section.index > 0 });
        pending = [];
      }
    }
    return markers;
  }

  function fingeringXml(pitch: PianoPitch): string {
    const initial = pitch.fingering === undefined ? '' : `<fingering>${pitch.fingering}</fingering>`;
    const substitution = pitch.substitutionFingering === undefined ? ''
      : `<fingering substitution="yes">${pitch.substitutionFingering}</fingering>`;
    return initial || substitution ? `<technical>${initial}${substitution}</technical>` : '';
  }

  export function prepare(outline: ScoreProject['outline']) {
    const measures = outline.filter((block) => block.type === 'measure');
    const starts: number[] = [];
    const incomingPedal: boolean[] = [];
    let position = 0, pedalDown = false;
    for (const measure of measures) {
      starts.push(position);
      incomingPedal.push(pedalDown);
      position += measure.data.length.cnt / measure.data.length.unit * 16;
      for (const event of [...(measure.data.pedalEvents ?? [])].sort((a, b) => MusicalTime.compare(a.offset, b.offset))) {
        pedalDown = event.action !== 'stop';
      }
    }
    return { measures, starts, incomingPedal, sectionNameByMeasure: sectionMarkers(outline), keys: ScoreKey.buildMeasureCache(outline) };
  }

  export function create(outline: ScoreProject['outline'], activeIndex: number, trills: ScoreProject['trills'] = [], tempoChanges: ScoreProject['tempoChanges'] = [], clefChanges: ScoreProject['clefChanges'] = [], slurs: ScoreProject['slurs'] = [], dynamicChanges: ScoreProject['dynamicChanges'] = [], prepared = prepare(outline)) {
    const { measures, starts, incomingPedal, sectionNameByMeasure, keys } = prepared;
    if (activeIndex < 0 || activeIndex >= measures.length) return null;
    const firstIndex = Math.max(0, activeIndex - 1);
    const visible = measures.slice(firstIndex, activeIndex + 2);
    const visibleIds = new Set(visible.flatMap((measure) => [measure.data.upperStaff, measure.data.lowerStaff]
      .flatMap((staff) => staff.voices.flatMap((voice) => ScoreVoice.flatten(voice, measure.data.length).map(({ element }) => element.id)))));
    const initial = outline[0].data;
    const noteTargets = visible.flatMap((measure, measureOffset) => [measure.data.upperStaff, measure.data.lowerStaff].flatMap((staff, staffIndex) =>
      staff.voices.flatMap((voice, voiceIndex) => ScoreVoice.flatten(voice, measure.data.length).flatMap(entry => entry.element.kind === 'note'
        ? [{ noteId: entry.element.id, measureOffset, staffIndex, voiceNumber: staffIndex * 3 + voiceIndex + 1, position: entry.positionSixteenths }] : []))));
    const slurMarks = new Map<string, string>();
    // Non-overlapping ranges per staff/voice require at most six simultaneous numbers.
    for (const span of ScoreSlur.ranges({ outline, slurs })) {
      const clipped = span.members.filter(entry => visibleIds.has(entry.note.id));
      if (!clipped.length) continue;
      const number = (span.first.staff === 'upperStaff' ? 0 : 3) + span.first.voiceIndex + 1;
      const first = clipped[0].note.id, last = clipped.at(-1)!.note.id;
      slurMarks.set(first, (slurMarks.get(first) ?? '') + `<slur type="start" number="${number}" placement="above"/>`);
      slurMarks.set(last, (slurMarks.get(last) ?? '') + `<slur type="stop" number="${number}"/>`);
    }
    const tempoProject = { outline, tempoChanges };
    const clefProject = { outline, clefChanges };
    const clefs = ScoreClef.changes(clefProject);
    const clefXml = (clef: Clef, number: number) => `<clef number="${number}"><sign>${clef === 'treble' ? 'G' : 'F'}</sign><line>${clef === 'treble' ? 2 : 4}</line></clef>`;
    const tempos = ScoreTempo.changes(tempoProject);
    const dynamics = ScoreDynamics.changes({ outline, dynamicChanges });
    const ottavaEvents = ScoreOttava.events({ outline });
    const beat = Meter.beatLength(initial.timeSignature);
    const beatLength = beat.cnt / beat.unit * 16;
    const tempoDirection = (bpm: number, offset: number) => `<direction placement="above"><direction-type><metronome><beat-unit>${beat.unit === 8 ? beat.cnt === 3 ? 'quarter' : 'eighth' : 'quarter'}</beat-unit>${beat.cnt === 3 ? '<beat-unit-dot/>' : ''}<per-minute>${bpm}</per-minute></metronome></direction-type><offset sound="yes">${Math.round(offset * ticksPerSixteenth)}</offset><staff>1</staff><sound tempo="${bpm * beatLength / 4}"/></direction>`;
    const trillByNote = new Map<string, string>();
    for (const span of trills) {
      const chain = ScoreTrill.chain({ outline }, span.startNoteId);
      if (chain.at(-1)?.id !== span.endNoteId || !chain.every(note => note.pitches.length === 1)) continue;
      const clipped = chain.filter(note => visibleIds.has(note.id));
      const trillKey = ScoreKey.forNote(outline, span.startNoteId);
      const auxiliary = TrillPitch.above(chain[0].pitches[0].midi, trillKey, span.settings.auxiliary);
      const keyAux = TrillPitch.above(chain[0].pitches[0].midi, trillKey, 'diatonic');
      const accidental = auxiliary.alter !== keyAux.alter ? ['flat-flat', 'flat', 'natural', 'sharp', 'double-sharp'][auxiliary.alter + 2] : undefined;
      clipped.forEach((note, index) => {
        const start = index === 0, stop = index === clipped.length - 1;
        const sound = ' start-note="' + (span.settings.start === 'main' ? 'main' : 'upper') + '" beats="' + span.settings.attackCount + '" trill-step="' + (auxiliary.midi - chain[0].pitches[0].midi === 1 ? 'half' : 'whole') + '"';
        const ornament = (start ? '<trill-mark' + sound + '/>' : '') +
          (start ? '<wavy-line type="start" number="1"/>' : '') +
          (!start && !stop ? '<wavy-line type="continue" number="1"/>' : '') +
          (stop ? '<wavy-line type="stop" number="1"/>' : '') +
          (start && accidental ? '<accidental-mark placement="above">' + accidental + '</accidental-mark>' : '');
        trillByNote.set(note.id, ornament);
      });
    }
    const noteResolution = visible.reduce((resolution, measure) => [measure.data.upperStaff, measure.data.lowerStaff].reduce((staffResolution, staff) =>
      staff.voices.reduce((voiceResolution, voice) => ScoreVoice.flatten(voice, measure.data.length).reduce((value, entry) => MusicalTime.lcm(value, entry.lengthTime.denominator), voiceResolution), staffResolution), resolution), 2);
    const ticksPerSixteenth = visible.reduce((resolution, measure) =>
      [...(measure.data.pedalEvents ?? []), ...(measure.data.ottavaEvents ?? [])]
        .reduce((value, event) => MusicalTime.lcm(value, event.offset.denominator), resolution), noteResolution);
    // A preview is only a window into the score. Reconstruct its incoming pedal state
    // without inserting events into the saved project.
    let pedalDown = incomingPedal[firstIndex];
    const pedals: PreviewPedalEvent[] = [];
    const ottavas: PreviewOttavaEvent[] = [];
    const visibleStart = starts[firstIndex];
    const visibleEnd = visibleStart + visible.reduce((sum, measure) => sum + measure.data.length.cnt / measure.data.length.unit * 16, 0);
    const visibleOttavaEvents = ottavaEvents.filter(event => event.position >= visibleStart && event.position <= visibleEnd);
    for (const staff of ['upperStaff', 'lowerStaff'] as const) {
      const prior = ottavaEvents.filter(event => event.staff === staff && event.position < visibleStart).at(-1);
      if (prior?.action === 'start') ottavas.push({ measureOffset: 0, position: 0, staff, type: staff === 'upperStaff' ? 'down' : 'up' });
      for (const event of visibleOttavaEvents.filter(event => event.staff === staff)) {
        const relative = event.position - visibleStart;
        const ownerIndex = visible.findIndex((measure, index) => {
          const start = visible.slice(0, index).reduce((sum, entry) => sum + entry.data.length.cnt / entry.data.length.unit * 16, 0);
          const end = start + measure.data.length.cnt / measure.data.length.unit * 16;
          return relative >= start && (relative < end || (index === visible.length - 1 && relative === end));
        });
        if (ownerIndex < 0) continue;
        const measureStart = visible.slice(0, ownerIndex).reduce((sum, entry) => sum + entry.data.length.cnt / entry.data.length.unit * 16, 0);
        ottavas.push({ measureOffset: ownerIndex, position: relative - measureStart, staff,
          type: event.action === 'stop' ? 'stop' : staff === 'upperStaff' ? 'down' : 'up' });
      }
      const stateAtEnd = ottavaEvents.filter(event => event.staff === staff && event.position < visibleEnd).at(-1);
      const hasEndEvent = visibleOttavaEvents.some(event => event.staff === staff && event.position === visibleEnd && event.action === 'stop');
      if (stateAtEnd?.action === 'start' && !hasEndEvent) {
        const lastIndex = visible.length - 1;
        const lastLength = visible[lastIndex].data.length.cnt / visible[lastIndex].data.length.unit * 16;
        ottavas.push({ measureOffset: lastIndex, position: lastLength, staff, type: 'stop' });
      }
    }
    const pitchXml = (pitch: PianoPitch, key: KeySignature) => {
      const spelling = PitchSpelling.forPreview(pitch.midi, key, pitch.spellingDirection);
      return `<pitch><step>${spelling.step}</step><alter>${spelling.alter}</alter><octave>${spelling.octave}</octave></pitch>`;
    };
    const content = visible.map((measure, index) => {
      const length = measure.data.length.cnt / measure.data.length.unit * 16;
      const irregular = length !== initial.timeSignature.cnt / initial.timeSignature.unit * 16;
      const measureStart = starts[firstIndex + index];
      const measureKey = keys.get(measure.id)!.keySignature;
      const previousKey = firstIndex + index > 0 ? keys.get(measures[firstIndex + index - 1].id)!.keySignature : initial.keySignature;
      let body = index === 0 ? `<attributes><divisions>${ticksPerSixteenth * 4}</divisions><key><fifths>${measureKey.fifths}</fifths></key>` +
        `<time><beats>${initial.timeSignature.cnt}</beats><beat-type>${initial.timeSignature.unit}</beat-type></time>` +
        '<staves>2</staves>' + clefXml(ScoreClef.at(clefProject, 'upperStaff', measureStart), 1) + clefXml(ScoreClef.at(clefProject, 'lowerStaff', measureStart), 2) + '</attributes>' : '';
      if (index > 0 && measureKey.fifths !== previousKey.fifths) body += `<attributes><key><fifths>${measureKey.fifths}</fifths></key></attributes>`;
      const ottavaDirection = (event: PreviewOttavaEvent) => {
        const number = event.staff === 'upperStaff' ? 1 : 2;
        const placement = event.staff === 'upperStaff' ? 'above' : 'below';
        return `<direction placement="${placement}"><direction-type><octave-shift type="${event.type}" size="8" number="${number}"/></direction-type><staff>${number}</staff></direction>`;
      };
      // Measure-head shifts can be read before any voice entry exists. Later shifts
      // are emitted in their staff's first voice at the matching score-time boundary.
      for (const event of ottavas.filter(event => event.measureOffset === index && event.position === 0)) {
        body += ottavaDirection(event);
      }
      const pedalEvents: { offset: PedalEvent['offset']; type: PreviewPedalEvent['type'] }[] = [...(measure.data.pedalEvents ?? [])]
        .sort((a, b) => MusicalTime.compare(a.offset, b.offset)).map(event => ({ offset: event.offset, type: event.action }));
      if (index === 0 && pedalDown) {
        if (pedalEvents[0] && MusicalTime.compare(pedalEvents[0].offset, MusicalTime.create(0)) === 0) {
          // At the left boundary a release has no visible span; a retake resumes it.
          if (pedalEvents[0].type === 'stop') { pedalEvents.shift(); pedalDown = false; }
          else pedalEvents[0] = { ...pedalEvents[0], type: 'resume' };
        } else pedalEvents.unshift({ offset: MusicalTime.create(0), type: 'resume' });
      }
      for (const event of pedalEvents) {
        body += `<direction placement="below"><direction-type><pedal type="${event.type}" line="yes" sign="no" number="1"/></direction-type><offset>${event.offset.numerator * (ticksPerSixteenth / event.offset.denominator)}</offset><staff>2</staff></direction>`;
        pedals.push({ measureOffset: index, position: MusicalTime.toNumber(event.offset), type: event.type });
        pedalDown = event.type !== 'stop';
      }
      if (index === visible.length - 1 && pedalDown) {
        // A clipped/open line has no release hook. This is presentation only.
        body += `<direction placement="below"><direction-type><pedal type="discontinue" line="yes" sign="no" number="1"/></direction-type><offset>${length * ticksPerSixteenth}</offset><staff>2</staff></direction>`;
        pedals.push({ measureOffset: index, position: length, type: 'discontinue' });
      }
      const localTempos = tempos.filter(change => change.measureId === measure.id);
      if (index === 0 && !localTempos.some(change => change.localPosition === 0)) {
        const firstStart = visibleStart;
        body += tempoDirection(ScoreTempo.at(tempoProject, firstStart), 0);
      }
      for (const change of localTempos) body += tempoDirection(change.bpm, change.localPosition);
      for (const change of dynamics.filter(change => change.measureId === measure.id)) {
        body += `<direction placement="below"><direction-type><dynamics><${change.level}/></dynamics></direction-type><offset>${Math.round(change.localPosition * ticksPerSixteenth)}</offset><staff>1</staff></direction>`;
      }
      // Attributes have no offset. Place staff-wide changes in score time, then
      // rewind to the measure head before writing each voice's unchanged notes.
      let clefPosition = 0;
      for (const change of clefs.filter(change => change.measureId === measure.id)) {
        if (index === 0 && change.localPosition === 0) continue;
        const position = Math.round(change.localPosition * ticksPerSixteenth);
        if (position > clefPosition) body += `<forward><duration>${position - clefPosition}</duration></forward>`;
        body += `<attributes>${clefXml(change.clef, change.staff === 'upperStaff' ? 1 : 2)}</attributes>`;
        clefPosition = position;
      }
      if (clefPosition > 0) body += `<backup><duration>${clefPosition}</duration></backup>`;
      let voiceCount = 0;
      [measure.data.upperStaff, measure.data.lowerStaff].forEach((staff, staffIndex) => staff.voices.forEach((voice, voiceIndex) => {
        if (voiceCount++ > 0) body += `<backup><duration>${length * ticksPerSixteenth}</duration></backup>`;
        const voiceNumber = staffIndex * 3 + voiceIndex + 1;
        const voiceOttavas = voiceIndex === 0
          ? ottavas.filter(event => event.measureOffset === index && event.staff === (staffIndex === 0 ? 'upperStaff' : 'lowerStaff'))
            .filter(event => event.position > 0).sort((a, b) => a.position - b.position)
          : [];
        let ottavaIndex = 0;
        const writeOttavasThrough = (position: number) => {
          while (ottavaIndex < voiceOttavas.length && voiceOttavas[ottavaIndex].position <= position + 1e-9) {
            const event = voiceOttavas[ottavaIndex++];
            body += ottavaDirection(event);
          }
        };
        if (voiceIndex === 0) writeOttavasThrough(0);
        for (const entry of ScoreVoice.flatten(voice, measure.data.length)) {
          const { element, tuplet, childIndex } = entry;
          const duration = entry.lengthTime.numerator * (ticksPerSixteenth / entry.lengthTime.denominator);
          const written = element.kind === 'measure-rest' ? '' : `<type>${element.value.type}</type>${'<dot/>'.repeat(element.value.dots)}`;
          const modification = tuplet ? '<time-modification><actual-notes>' + tuplet.actual + '</actual-notes><normal-notes>' + tuplet.normal + '</normal-notes><normal-type>' + tuplet.baseType + '</normal-type></time-modification>' : '';
          const bracket = tuplet ? (childIndex === 0 ? '<tuplet type="start" bracket="yes"/>' : '') + (childIndex === tuplet.elements.length - 1 ? '<tuplet type="stop"/>' : '') : '';
          if (element.kind !== 'note') {
            body += `<note>${element.kind === 'measure-rest' ? '<rest measure="yes"/>' : '<rest/>'}<duration>${duration}</duration><voice>${voiceNumber}</voice>${written}${modification}<staff>${staffIndex + 1}</staff>${bracket ? `<notations>${bracket}</notations>` : ''}</note>`;
            if (voiceIndex === 0) writeOttavasThrough(entry.positionSixteenths + entry.lengthSixteenths);
            continue;
          }
          for (const grace of element.beforeGraceNotes ?? []) {
            grace.pitches.forEach((pitch, pitchIndex) => {
              const fingering = fingeringXml(pitch);
              body += `<note><grace slash="${grace.slash ? 'yes' : 'no'}"/>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch, measureKey)}` +
                `<voice>${voiceNumber}</voice><type>${grace.value.type}</type>${'<dot/>'.repeat(grace.value.dots)}<staff>${staffIndex + 1}</staff>${fingering ? `<notations>${fingering}</notations>` : ''}</note>`;
            });
          }
          const from = element.tieFrom !== undefined && visibleIds.has(element.tieFrom);
          const to = element.tieTo !== undefined && visibleIds.has(element.tieTo);
          element.pitches.forEach((pitch, pitchIndex) => {
            const ties = `${from ? '<tie type="stop"/>' : ''}${to ? '<tie type="start"/>' : ''}`;
            const notations = (pitchIndex === 0 ? bracket + (slurMarks.get(element.id) ?? '') : '') +
              (pitchIndex === 0 && trillByNote.has(element.id) ? '<ornaments>' + trillByNote.get(element.id)!.replaceAll('number="1"', 'number="' + voiceNumber + '"') + '</ornaments>' : '') + `${from ? '<tied type="stop"/>' : ''}${to ? '<tied type="start"/>' : ''}` +
              (pitchIndex === 0 && element.fermata ? '<fermata type="upright"/>' : '') +
              (pitchIndex === 0 && (element.staccato || element.accent) ? `<articulations>${element.accent ? '<accent/>' : ''}${element.staccato ? `<${element.staccato.type === 'normal' ? 'staccato' : 'staccatissimo'}/>` : ''}</articulations>` : '') +
              (element.arpeggio ? `<arpeggiate number="${voiceNumber}"${element.arpeggio.type === 'down' ? ' direction="down"' : ''}/>` : '') +
              fingeringXml(pitch);
            body += `<note>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch, measureKey)}<duration>${duration}</duration>${ties}<voice>${voiceNumber}</voice>${written}${modification}` +
              (staff.voices.length > 1 ? `<stem>${voiceIndex % 2 === 0 ? 'up' : 'down'}</stem>` : '') +
              `<staff>${staffIndex + 1}</staff>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
          });
          if (voiceIndex === 0) writeOttavasThrough(entry.positionSixteenths + entry.lengthSixteenths);
        }
        if (voiceIndex === 0) writeOttavasThrough(length);
      }));
      const nextMeasure = measures[firstIndex + index + 1];
      if (nextMeasure && sectionNameByMeasure.get(nextMeasure.id)?.doubleBarline) {
        // The right side of the previous measure is the reliable shared boundary in OSMD.
        body += '<barline location="right"><bar-style>light-light</bar-style></barline>';
      }
      return `<measure number="${firstIndex + index + 1}"${irregular ? ' implicit="yes"' : ''}>${body}</measure>`;
    }).join('');
    return {
      noteTargets,
      sectionMarks: visible.flatMap((measure, measureOffset) => {
        const section = sectionNameByMeasure.get(measure.id);
        return section === undefined ? [] : [{ measureOffset, name: section.name }];
      }),
      activeOffset: activeIndex - firstIndex,
      pedals,
      ottavas,
      xml: '<?xml version="1.0" encoding="UTF-8"?>' +
        '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
        `<part id="P1">${content}</part></score-partwise>`,
    };
  }

}
export default PreviewMusicXml;
