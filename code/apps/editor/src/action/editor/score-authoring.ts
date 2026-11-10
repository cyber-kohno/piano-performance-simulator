import Input from '../../domain/score/score-authoring-input.ts';
import ScoreProjectValidator from '../../domain/score/score-project-validator.ts';
import ScoreVoice from '../../domain/score/score-voice.ts';
import ScoreKey from '../../domain/score/score-key.ts';
import MusicalTime from '../../domain/theory/musical-time.ts';
import type { KeySignature, MeasureBlock, PianoNote, PianoRest, PianoStaff, PianoVoiceElement, ScoreProject } from '../../domain/score/types.ts';

export type AuthoringState = { started: boolean; pending: Record<string, string> };
export type AuthoringSummary = { firstMeasure: number; lastMeasure: number; addedMeasures: number; addedNotes: number; unresolvedTies: number };

namespace ScoreAuthoring {
  export function createState(): AuthoringState { return { started: false, pending: {} }; }
  function sameChord(a: PianoNote, b: PianoNote) {
    return a.pitches.length === b.pitches.length && a.pitches.every((pitch, i) =>
      pitch.midi === b.pitches[i].midi && pitch.spellingDirection === b.pitches[i].spellingDirection);
  }

  function notes(project: ScoreProject) {
    const result = new Map<string, PianoNote>();
    for (const block of project.outline) if (block.type === 'measure')
      for (const staff of [block.data.upperStaff, block.data.lowerStaff]) for (const voice of staff.voices)
        for (const entry of ScoreVoice.flatten(voice, block.data.length))
          if (entry.element.kind === 'note') result.set(entry.element.id, entry.element);
    return result;
  }

  function event(value: unknown, key: KeySignature, path: string, ties: Set<string>): PianoNote | PianoRest {
    const item = Input.record(value, ['value', 'pitches', 'rest', 'tie'], path);
    const written = Input.noteValue(item.value, `${path}.value`);
    if (item.rest === true) {
      if (item.pitches !== undefined || item.tie !== undefined) Input.fail(path, 'A rest cannot have pitches or a tie.');
      return { id: crypto.randomUUID(), kind: 'rest', value: written };
    }
    if (item.rest !== undefined) Input.fail(`${path}.rest`, 'Only rest: true is supported.');
    if (item.tie !== undefined && typeof item.tie !== 'boolean') Input.fail(`${path}.tie`, 'Expected a boolean.');
    const pitches = Input.array(item.pitches, 1, 88, `${path}.pitches`).map((pitch, i) => Input.pitch(pitch, key, `${path}.pitches[${i}]`));
    if (new Set(pitches.map(pitch => pitch.midi)).size !== pitches.length) Input.fail(`${path}.pitches`, 'Duplicate sounding pitches in a chord.');
    pitches.sort((a, b) => b.midi - a.midi);
    const note: PianoNote = { id: crypto.randomUUID(), kind: 'note', value: written, pitches };
    if (item.tie) ties.add(note.id);
    return note;
  }

  function element(value: unknown, key: KeySignature, path: string, ties: Set<string>): PianoVoiceElement {
    if (value && typeof value === 'object' && 'tuplet' in value) {
      const wrapper = Input.record(value, ['tuplet'], path);
      const group = Input.record(wrapper.tuplet, ['actual', 'normal', 'base', 'events'], `${path}.tuplet`);
      const actual = Input.integer(group.actual, 2, 64, `${path}.tuplet.actual`);
      const normal = Input.integer(group.normal, 1, 64, `${path}.tuplet.normal`);
      const base = Input.noteValue(group.base, `${path}.tuplet.base`);
      if (base.dots) Input.fail(path, 'Tuplet base must be undotted.');
      const children = Input.array(group.events, actual, actual, `${path}.tuplet.events`).map((child, i) => event(child, key, `${path}.tuplet.events[${i}]`, ties));
      const result = { id: crypto.randomUUID(), kind: 'tuplet' as const, actual, normal, baseType: base.type, elements: children };
      try { ScoreVoice.time(result, { cnt: 4, unit: 4 }); }
      catch { Input.fail(`${path}.tuplet.events`, 'Written durations must sum to actual base notes.'); }
      return result;
    }
    return event(value, key, path, ties);
  }

  export function staff(value: unknown, key: KeySignature, length: MeasureBlock['data']['length'], path: string, ties: Set<string>): PianoStaff {
    if (value === undefined) return { voices: [{ id: 'voice-0', elements: [{ id: crypto.randomUUID(), kind: 'measure-rest' }] }] };
    return { voices: Input.array(value, 1, 3, path).map((voice, i) => {
      const voicePath = `${path}[${i}]`;
      const elements = Input.array(voice, 1, 256, voicePath).map((item, j) => element(item, key, `${voicePath}[${j}]`, ties));
      const total = elements.reduce((sum, item) => MusicalTime.add(sum, ScoreVoice.time(item, length)), MusicalTime.create(0));
      const expected = MusicalTime.create(length.cnt * 16, length.unit);
      if (MusicalTime.compare(total, expected) !== 0) {
        const difference = MusicalTime.subtract(expected, total);
        Input.fail(voicePath, `Voice duration must fill the measure; difference in sixteenths: ${difference.numerator}/${difference.denominator}.`);
      }
      return { id: `voice-${i}`, elements };
    }) };
  }

  /** Pure candidate construction: callers publish the result only after the whole batch succeeds. */
  export function apply(project: ScoreProject, state: AuthoringState, operations: unknown, validateResult = true) {
    // The GUI supplies Svelte reactive proxies; the persisted model is JSON data.
    const candidate = JSON.parse(JSON.stringify(project)) as ScoreProject;
    const nextState = structuredClone(state);
    const before = candidate.outline.filter(block => block.type === 'measure').length;
    let addedNotes = 0, addedMeasures = 0;
    Input.array(operations, 1, 16, 'operations').forEach((operation, operationIndex) => {
      const path = `operations[${operationIndex}]`;
      const op = Input.record(operation, ['type', 'settings', 'measures'], path);
      if (op.type === 'create_score') {
        if (nextState.started || candidate.outline.length !== 2 || candidate.outline[0].type !== 'init' || candidate.outline[1].type !== 'section' ||
          [candidate.slurs, candidate.clefChanges, candidate.tempoChanges, candidate.dynamicChanges, candidate.trills].some(items => items && items.length))
          Input.fail(path, 'create_score requires an empty project with only initial values and one section.', 'SCORE_NOT_EMPTY');
        const settings = Input.record(op.settings, ['meter', 'keyFifths', 'tempo'], `${path}.settings`);
        const meter = Input.array(settings.meter, 2, 2, `${path}.settings.meter`);
        const cnt = Input.integer(meter[0], 1, 64, `${path}.settings.meter[0]`);
        const unit = Input.integer(meter[1], 1, 64, `${path}.settings.meter[1]`);
        if (![1, 2, 4, 8, 16, 32, 64].includes(unit)) Input.fail(path, 'Meter denominator must be a power of two from 1 to 64.');
        const fifths = Input.integer(settings.keyFifths, -7, 7, `${path}.settings.keyFifths`) as KeySignature['fifths'];
        const tempo = Input.integer(settings.tempo, 10, 400, `${path}.settings.tempo`);
        candidate.outline[0].data = { timeSignature: { cnt, unit }, keySignature: { fifths }, tempo };
        nextState.started = true;
      } else if (op.type === 'append_measures') {
        if (op.settings !== undefined) Input.fail(path, 'append_measures cannot change settings.');
      } else Input.fail(`${path}.type`, 'Expected create_score or append_measures.');
      const measures = Input.array(op.measures, 1, 32, `${path}.measures`);
      addedMeasures += measures.length;
      if (addedMeasures > 32) Input.fail(path, 'At most 32 measures per request.', 'REQUEST_LIMIT');
      if (candidate.outline.filter(block => block.type === 'measure').length + measures.length > 512)
        Input.fail(path, 'At most 512 measures per authoring checkout.', 'REQUEST_LIMIT');
      const length = candidate.outline[0].data.timeSignature;
      const key = ScoreKey.forBlock(candidate.outline, candidate.outline.at(-1)!.id);
      const byId = notes(candidate);
      measures.forEach((value, i) => {
        const measurePath = `${path}.measures[${i}]`;
        const measure = Input.record(value, ['upper', 'lower', 'length'], measurePath);
        const actualLength = measure.length === undefined ? length : (() => {
          const pair = Input.array(measure.length, 2, 2, `${measurePath}.length`);
          return { cnt: Input.integer(pair[0], 1, 256, `${measurePath}.length[0]`), unit: Input.integer(pair[1], 1, 64, `${measurePath}.length[1]`) };
        })();
        const ties = new Set<string>();
        const block: MeasureBlock = { id: crypto.randomUUID(), type: 'measure', data: {
          length: { ...actualLength }, upperStaff: staff(measure.upper, key, actualLength, `${measurePath}.upper`, ties),
          lowerStaff: staff(measure.lower, key, actualLength, `${measurePath}.lower`, ties),
        } };
        const seen = new Set<string>();
        for (const name of ['upperStaff', 'lowerStaff'] as const) block.data[name].voices.forEach((voice, voiceIndex) => {
          const scope = `${name}:${voice.id}`;
          seen.add(scope);
          for (const entry of ScoreVoice.flatten(voice, actualLength)) {
            const item = entry.element;
            const pendingId = nextState.pending[scope];
            if (pendingId) {
              const source = byId.get(pendingId)!;
              if (item.kind !== 'note' || !sameChord(source, item))
                Input.fail(`${measurePath}.${name === 'upperStaff' ? 'upper' : 'lower'}[${voiceIndex}][${entry.index}]${entry.tuplet ? `.tuplet.events[${entry.childIndex}]` : ''}`,
                  'A tie must continue immediately into the same complete chord.', 'INVALID_TIE');
              source.tieTo = item.id;
              item.tieFrom = source.id;
              delete nextState.pending[scope];
            }
            if (item.kind === 'note') {
              byId.set(item.id, item);
              addedNotes++;
              if (ties.has(item.id)) nextState.pending[scope] = item.id;
            }
          }
        });
        for (const scope of Object.keys(nextState.pending)) if (!seen.has(scope))
          Input.fail(measurePath, `Missing voice for pending tie: ${scope}.`, 'INVALID_TIE');
        candidate.outline.push(block);
      });
    });
    if (validateResult) validate(candidate, nextState, false);
    const summary: AuthoringSummary = { firstMeasure: before + 1, lastMeasure: before + addedMeasures, addedMeasures, addedNotes,
      unresolvedTies: Object.keys(nextState.pending).length };
    return { project: candidate, state: nextState, summary };
  }

  export function validate(project: ScoreProject, state: AuthoringState, final: boolean) {
    if (!ScoreProjectValidator.isValid(project)) Input.fail('project', 'Invalid generated score.', 'INVALID_SCORE');
    const ids = new Set<string>();
    const addId = (id: string) => { if (ids.has(id)) Input.fail('project', `Duplicate ID: ${id}.`, 'INVALID_SCORE'); ids.add(id); };
    const entries = new Map<string, { note: PianoNote; scope: string; voiceIndex: number; start: ReturnType<typeof MusicalTime.create>; end: ReturnType<typeof MusicalTime.create> }>();
    let offset = MusicalTime.create(0);
    for (const block of project.outline) {
      addId(block.id);
      if (block.type !== 'measure') continue;
      for (const name of ['upperStaff', 'lowerStaff'] as const) {
        const voices = new Set<string>();
        for (const [voiceIndex, voice] of block.data[name].voices.entries()) {
          if (voices.has(voice.id)) Input.fail('project', 'Duplicate voice identity within a staff.', 'INVALID_SCORE');
          voices.add(voice.id);
          for (const element of voice.elements) if (element.kind === 'tuplet') addId(element.id);
          for (const entry of ScoreVoice.flatten(voice, block.data.length)) {
            addId(entry.element.id);
            if (entry.element.kind === 'note') entries.set(entry.element.id, { note: entry.element, scope: `${name}:${voice.id}`, voiceIndex,
              start: MusicalTime.add(offset, entry.positionTime), end: MusicalTime.add(offset, MusicalTime.add(entry.positionTime, entry.lengthTime)) });
          }
        }
      }
      offset = MusicalTime.add(offset, MusicalTime.create(block.data.length.cnt * 16, block.data.length.unit));
    }
    for (const entry of entries.values()) {
      const target = entry.note.tieTo ? entries.get(entry.note.tieTo) : undefined;
      if (entry.note.tieTo && (!target || target.note.tieFrom !== entry.note.id || target.scope !== entry.scope || target.voiceIndex !== entry.voiceIndex ||
        MusicalTime.compare(entry.end, target.start) !== 0 || !sameChord(target.note, entry.note)))
        Input.fail('project', `Invalid tie from ${entry.note.id}.`, 'INVALID_TIE');
      if (entry.note.tieFrom && entries.get(entry.note.tieFrom)?.note.tieTo !== entry.note.id)
        Input.fail('project', `Invalid tie to ${entry.note.id}.`, 'INVALID_TIE');
    }
    for (const [scope, id] of Object.entries(state.pending)) {
      const entry = entries.get(id);
      if (!entry || entry.scope !== scope || entry.note.tieTo || MusicalTime.compare(entry.end, offset) !== 0)
        Input.fail('project', 'Invalid pending tie.', 'INVALID_TIE');
    }
    if (final && Object.keys(state.pending).length) Input.fail('project', 'Append measures to resolve pending ties before finishing.', 'UNRESOLVED_TIES');
  }
}
export default ScoreAuthoring;
