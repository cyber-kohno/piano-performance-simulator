
import TrillPitch from "../../domain/theory/trill-pitch.ts";

import ScoreTrill from "../../domain/score/score-trill.ts";

import ScoreClef from "../../domain/score/score-clef.ts";

import ScoreTempo from "../../domain/score/score-tempo.ts";

import ScoreSlur from "../../domain/score/score-slur.ts";

import PitchSpelling from "../../domain/theory/pitch-spelling.ts";

import ScoreVoice from "../../domain/score/score-voice.ts";
import MusicalTime from "../../domain/theory/musical-time.ts";
import Meter from "../../domain/theory/meter.ts";
import ScoreKey from "../../domain/score/score-key.ts";

import { type Clef } from "../../domain/score/score-clef.ts";

import { type KeySignature, type PedalEvent, type PianoPitch, type ScoreProject } from "../../domain/score/types.ts";

export type PreviewPedalEvent = {
  measureOffset: number;
  position: number;
  type: PedalEvent['action'] | 'resume' | 'discontinue';
};

namespace PreviewMusicXml {
  export const spellPitch = PitchSpelling.forPreview;

  export function create(outline: ScoreProject['outline'], activeIndex: number, trills: ScoreProject['trills'] = [], tempoChanges: ScoreProject['tempoChanges'] = [], clefChanges: ScoreProject['clefChanges'] = [], slurs: ScoreProject['slurs'] = []) {
    const measures = outline.filter((block) => block.type === 'measure');
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
      (measure.data.pedalEvents ?? []).reduce((value, event) => MusicalTime.lcm(value, event.offset.denominator), resolution), noteResolution);
    // A preview is only a window into the score. Reconstruct its incoming pedal state
    // without inserting events into the saved project.
    let pedalDown = false;
    const pedals: PreviewPedalEvent[] = [];
    for (const measure of measures.slice(0, firstIndex)) {
      for (const event of [...(measure.data.pedalEvents ?? [])].sort((a, b) => MusicalTime.compare(a.offset, b.offset))) {
        pedalDown = event.action !== 'stop';
      }
    }
    const pitchXml = (pitch: PianoPitch, key: KeySignature) => {
      const spelling = PitchSpelling.forPreview(pitch.midi, key);
      return `<pitch><step>${spelling.step}</step><alter>${spelling.alter}</alter><octave>${spelling.octave}</octave></pitch>`;
    };
    const content = visible.map((measure, index) => {
      const length = measure.data.length.cnt / measure.data.length.unit * 16;
      const irregular = length !== initial.timeSignature.cnt / initial.timeSignature.unit * 16;
      const measureStart = measures.slice(0, firstIndex + index).reduce((sum, block) => sum + block.data.length.cnt / block.data.length.unit * 16, 0);
      const measureKey = ScoreKey.forBlock(outline, measure.id);
      const previousKey = firstIndex + index > 0 ? ScoreKey.forBlock(outline, measures[firstIndex + index - 1].id) : initial.keySignature;
      let body = index === 0 ? `<attributes><divisions>${ticksPerSixteenth * 4}</divisions><key><fifths>${measureKey.fifths}</fifths></key>` +
        `<time><beats>${initial.timeSignature.cnt}</beats><beat-type>${initial.timeSignature.unit}</beat-type></time>` +
        '<staves>2</staves>' + clefXml(ScoreClef.at(clefProject, 'upperStaff', measureStart), 1) + clefXml(ScoreClef.at(clefProject, 'lowerStaff', measureStart), 2) + '</attributes>' : '';
      if (index > 0 && measureKey.fifths !== previousKey.fifths) body += `<attributes><key><fifths>${measureKey.fifths}</fifths></key></attributes>`;
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
        const firstStart = measures.slice(0, firstIndex).reduce((sum, block) => sum + block.data.length.cnt / block.data.length.unit * 16, 0);
        body += tempoDirection(ScoreTempo.at(tempoProject, firstStart), 0);
      }
      for (const change of localTempos) body += tempoDirection(change.bpm, change.localPosition);
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
        for (const entry of ScoreVoice.flatten(voice, measure.data.length)) {
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
              body += `<note><grace slash="${grace.slash ? 'yes' : 'no'}"/>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch, measureKey)}` +
                `<voice>${voiceNumber}</voice><type>${grace.value.type}</type>${'<dot/>'.repeat(grace.value.dots)}<staff>${staffIndex + 1}</staff>${fingering}</note>`;
            });
          }
          const from = element.tieFrom !== undefined && visibleIds.has(element.tieFrom);
          const to = element.tieTo !== undefined && visibleIds.has(element.tieTo);
          element.pitches.forEach((pitch, pitchIndex) => {
            const ties = `${from ? '<tie type="stop"/>' : ''}${to ? '<tie type="start"/>' : ''}`;
            const notations = (pitchIndex === 0 ? bracket + (slurMarks.get(element.id) ?? '') : '') +
              (pitchIndex === 0 && trillByNote.has(element.id) ? '<ornaments>' + trillByNote.get(element.id)!.replaceAll('number="1"', 'number="' + voiceNumber + '"') + '</ornaments>' : '') + `${from ? '<tied type="stop"/>' : ''}${to ? '<tied type="start"/>' : ''}` +
              (pitchIndex === 0 && element.staccato ? `<articulations><${element.staccato.type === 'normal' ? 'staccato' : 'staccatissimo'}/></articulations>` : '') +
              (element.arpeggio ? `<arpeggiate number="${voiceNumber}"${element.arpeggio.type === 'down' ? ' direction="down"' : ''}/>` : '') +
              (pitch.fingering ? `<technical><fingering>${pitch.fingering}</fingering></technical>` : '');
            body += `<note>${pitchIndex ? '<chord/>' : ''}${pitchXml(pitch, measureKey)}<duration>${duration}</duration>${ties}<voice>${voiceNumber}</voice>${written}${modification}` +
              (staff.voices.length > 1 ? `<stem>${voiceIndex % 2 === 0 ? 'up' : 'down'}</stem>` : '') +
              `<staff>${staffIndex + 1}</staff>${notations ? `<notations>${notations}</notations>` : ''}</note>`;
          });
        }
      }));
      return `<measure number="${firstIndex + index + 1}"${irregular ? ' implicit="yes"' : ''}>${body}</measure>`;
    }).join('');
    return {
      noteTargets,
      activeOffset: activeIndex - firstIndex,
      pedals,
      xml: '<?xml version="1.0" encoding="UTF-8"?>' +
        '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>' +
        `<part id="P1">${content}</part></score-partwise>`,
    };
  }

}
export default PreviewMusicXml;
