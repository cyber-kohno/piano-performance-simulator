import Contract from '../../domain/score/score-edit-contract.ts';
import Input from '../../domain/score/score-authoring-input.ts';
import ScoreVoice from '../../domain/score/score-voice.ts';
import ScoreFermata from '../../domain/score/score-fermata.ts';
import ScoreKey from '../../domain/score/score-key.ts';
import ScoreTempo from '../../domain/score/score-tempo.ts';
import ScorePedal from '../../domain/score/score-pedal.ts';
import ScoreOttava from '../../domain/score/score-ottava.ts';
import ScoreSlur from '../../domain/score/score-slur.ts';
import ScoreTrill from '../../domain/score/score-trill.ts';
import ScoreClef from '../../domain/score/score-clef.ts';
import ScoreDynamics from '../../domain/score/score-dynamics.ts';
import PitchSpelling from '../../domain/theory/pitch-spelling.ts';
import MusicalTime from '../../domain/theory/musical-time.ts';
import type { PianoPitch, PianoStaffName, ScoreProject } from '../../domain/score/types.ts';

namespace McpScoreReader {
  export function capabilities(operation?: unknown) {
    if (operation !== undefined && (typeof operation !== 'string' || !Contract.names.includes(operation))) Input.fail('operation', 'Unknown operation.');
    const operationSchema = operation === undefined ? undefined : Contract.operations.items!.anyOf!.find(schema => schema.properties!.type.enum!.includes(operation));
    return { operations: Contract.names, ...(operationSchema ? { operationSchema } : {}), limits: { operationsPerRequest: 64, newMeasuresPerRequest: 32, operationsBytes: 48 * 1024,
      successfulRequestsPerCheckout: 64, rangeMeasures: 8, responseBytes: 200 * 1024, voicesPerStaff: 3, midi: [21, 108], measureAdditionScoreLimit: 512 },
      timeUnit: 'quarter note; offsets and durations are exact {numerator, denominator} fractions',
      readWithoutCheckout: true, batchRequiresExpectedRevision: true, editsAreAtomic: true,
      restrictions: ['Existing model restrictions apply; unsupported settings are rejected.',
        'set_value does not fill rests: compensate durations in the same batch or replace the voice.',
        'Replacement creates new element IDs. Detach or retarget references explicitly.',
        'Tempo and dynamic changes anchor to upper-staff voice 1; clef changes anchor to voice 1. Dynamics set absolute base velocity for preview playback.',
        'Ottava is the existing per-staff octave notation; it is independent of note IDs.',
        'No nested tuplets; written tuplet durations sum to actual base notes and event count equals actual.',
        'Grace notes require a single principal note longer than a 32nd; trills require a single-note tie chain.',
        'Open pedal/ottava spans extend to score end, including appended measures. Add an explicit stop to fix their end.',
        'Pitch spelling must round-trip through the existing score model. Partial chord ties unsupported.'] };
  }

  export function overview(project: ScoreProject) {
    let number = 0;
    return { initialValues: project.outline[0].data, measureCount: project.outline.filter(b => b.type === 'measure').length,
      outline: project.outline.map(block => block.type === 'measure' ? { id: block.id, type: block.type, number: ++number, length: block.data.length }
        : { id: block.id, type: block.type, data: block.data }),
      expressionCounts: { slurs: project.slurs?.length ?? 0, trills: project.trills?.length ?? 0, tempoChanges: project.tempoChanges?.length ?? 0,
        clefChanges: project.clefChanges?.length ?? 0, dynamicChanges: project.dynamicChanges?.length ?? 0, pedalEvents: ScorePedal.events(project).length, ottavaEvents: ScoreOttava.events(project).length } };
  }

  export function range(project: ScoreProject, params: Record<string, unknown>) {
    const first = params.firstMeasure === undefined ? 1 : Input.integer(params.firstMeasure, 1, 100000, 'firstMeasure');
    const count = params.measureCount === undefined ? 4 : Input.integer(params.measureCount, 1, 8, 'measureCount');
    if (params.staff !== undefined && !['upperStaff', 'lowerStaff'].includes(String(params.staff))) Input.fail('staff', 'Invalid staff.');
    const voiceIndex = params.voiceIndex === undefined ? undefined : Input.integer(params.voiceIndex, 0, 2, 'voiceIndex');
    const all = ScorePedal.measures(project);
    if (first > Math.max(1, all.length)) Input.fail('firstMeasure', 'Measure range is outside the score.');
    const selected = all.slice(first - 1, first - 1 + count);
    const measureIds = new Set(selected.map(entry => entry.measure.id));
    const dynamicChanges = ScoreDynamics.changes(project).filter(change => measureIds.has(change.measureId))
      .map(({ noteId, level, velocity }) => ({ noteId, level, velocity }));
    const noteIds = new Set<string>();
    const quarter = (time: ReturnType<typeof MusicalTime.create>) => MusicalTime.multiply(time, MusicalTime.create(1, 4));
    const measures = selected.map(({ measure: block, start }, index) => {
      const key = ScoreKey.forBlock(project.outline, block.id);
      const pitch = (item: PianoPitch) => {
        const spelling = PitchSpelling.forPreview(item.midi, key, item.spellingDirection);
        const accidental = spelling.alter < 0 ? 'b'.repeat(-spelling.alter) : '#'.repeat(spelling.alter);
        return { ...item, name: `${spelling.step}${accidental}${spelling.octave}` };
      };
      return { id: block.id, number: first + index, length: block.data.length, keySignature: key, tempoAtStart: ScoreTempo.at(project, start), dynamicAtStart: ScoreDynamics.at(project, start), baseVelocityAtStart: ScoreDynamics.velocityAt(project, start),
        clefAtStart: { upperStaff: ScoreClef.at(project, 'upperStaff', start), lowerStaff: ScoreClef.at(project, 'lowerStaff', start) },
        staves: (['upperStaff', 'lowerStaff'] as PianoStaffName[]).filter(staff => params.staff === undefined || staff === params.staff).map(staff => ({ staff,
          voices: block.data[staff].voices.flatMap((voice, index) => voiceIndex !== undefined && voiceIndex !== index ? [] : [{ id: voice.id, index,
            elements: voice.elements, timeline: ScoreVoice.flatten(voice, block.data.length).map(entry => {
              const item = entry.element;
              if (item.kind === 'note') noteIds.add(item.id);
              return { id: item.id, kind: item.kind, offset: quarter(entry.positionTime), duration: quarter(entry.lengthTime),
                ...(item.kind === 'note' ? { pitches: item.pitches.map(pitch), gracePitches: item.beforeGraceNotes?.map(grace => ({ id: grace.id, pitches: grace.pitches.map(pitch) })) } : {}) };
            }) }]) })),
        pedalEvents: (block.data.pedalEvents ?? []).map(event => ({ ...event, offset: quarter(event.offset) })),
        ottavaEvents: (block.data.ottavaEvents ?? []).map(event => ({ ...event, offset: quarter(event.offset) })),
        incoming: { pedalDown: ScorePedal.events(project).filter(event => event.position < start).at(-1)?.action !== undefined &&
          ScorePedal.events(project).filter(event => event.position < start).at(-1)?.action !== 'stop',
          ottavaActive: (['upperStaff', 'lowerStaff'] as const).filter(staff => ScoreOttava.events(project, staff).filter(event => event.position < start).at(-1)?.action === 'start') },
      };
    });
    const slurs = ScoreSlur.ranges(project).filter(span => span.members.some(entry => noteIds.has(entry.note.id)))
      .map(({ id, startNoteId, endNoteId }) => ({ id, startNoteId, endNoteId }));
    const trills = (project.trills ?? []).filter(span => ScoreTrill.chain(project, span.startNoteId).some(note => noteIds.has(note.id)));
    const referenced = new Set([...slurs, ...trills].flatMap(span => [span.startNoteId, span.endNoteId]));
    for (const change of dynamicChanges) referenced.add(change.noteId);
    for (const measure of measures) for (const staff of measure.staves) for (const voice of staff.voices)
      for (const entry of ScoreVoice.flatten({ id: voice.id, elements: voice.elements }, measure.length))
        if (entry.element.kind === 'note') for (const id of [entry.element.tieFrom, entry.element.tieTo]) if (id) referenced.add(id);
    const externalAnchors = all.flatMap(({ measure: block }, index) => (['upperStaff', 'lowerStaff'] as const).flatMap(staff =>
      block.data[staff].voices.flatMap((voice, voiceIndex) => ScoreVoice.flatten(voice, block.data.length).flatMap(entry =>
        referenced.has(entry.element.id) && !noteIds.has(entry.element.id) ? [{ noteId: entry.element.id, measureId: block.id,
          measureNumber: index + 1, staff, voiceIndex, offset: quarter(entry.positionTime) }] : []))));
    const fermataGroups = ScoreFermata.groups(project).filter(group => group.noteIds.some(id => noteIds.has(id)))
      .map(({ startSixteenths, endSixteenths, ...group }) => ({ ...group,
        start: quarter(MusicalTime.fromNumber(startSixteenths)), end: quarter(MusicalTime.fromNumber(endSixteenths)) }));
    return { firstMeasure: first, returnedMeasures: measures.length, totalMeasures: all.length, measures, slurs, trills, fermataGroups,
      externalAnchors,
      tempoChanges: (project.tempoChanges ?? []).filter(change => noteIds.has(change.noteId)),
      dynamicChanges,
      clefChanges: (project.clefChanges ?? []).filter(change => noteIds.has(change.noteId)) };
  }

  export function bounded<T>(value: T): T {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 200 * 1024) Input.fail('response', 'Read a smaller range or filter by staff/voice.', 'RESPONSE_LIMIT');
    return value;
  }
}
export default McpScoreReader;
