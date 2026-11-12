import Authoring, { type AuthoringState } from './score-authoring.ts';
import Contract from '../../domain/score/score-edit-contract.ts';
import Input, { AuthoringError } from '../../domain/score/score-authoring-input.ts';
import ScoreVoice from '../../domain/score/score-voice.ts';
import ScoreKey from '../../domain/score/score-key.ts';
import ScoreTempo from '../../domain/score/score-tempo.ts';
import ScoreClef from '../../domain/score/score-clef.ts';
import ScoreSlur from '../../domain/score/score-slur.ts';
import ScoreTrill from '../../domain/score/score-trill.ts';
import Integrity from '../../domain/score/score-integrity.ts';
import Impact from '../../domain/score/score-edit-impact.ts';
import ScoreFermata from '../../domain/score/score-fermata.ts';
import ScoreDynamics from '../../domain/score/score-dynamics.ts';
import NotePitches from '../../domain/score/note-pitches.ts';
import ScoreFingerings from '../../domain/score/score-fingerings.ts';
import MusicalTime from '../../domain/theory/musical-time.ts';
import type { DynamicLevel, KeySignature, PianoNote, PianoStaffName, ScoreProject, TrillSettings, StaccatoSettings, ArpeggioSettings, GracePerformanceSettings, PianoFingering } from '../../domain/score/types.ts';

namespace ScoreEditing {
  export function apply(project: ScoreProject, state: AuthoringState, operations: unknown) {
    Contract.validate(operations);
    const fermataTiming = ScoreFermata.capture(project);
    const reappliedFermatas = new Set<string>();
    let candidate = JSON.parse(JSON.stringify(project)) as ScoreProject;
    let nextState = structuredClone(state);
    const changedIds = new Set<string>();
    let addedMeasures = 0, addedNotes = 0;
    const results: { type: string; ids: string[] }[] = [];

    (operations as Record<string, unknown>[]).forEach((op, operationIndex) => {
      const path = `operations[${operationIndex}]`;
      try {
        const type = op.type as string;
        if (['create_score', 'replace_voice', 'set_value', 'set_rest', 'set_measure_length',
          'remove_measures', 'insert_measures', 'append_measures', 'remove_voice'].includes(type)) reappliedFermatas.clear();
        const ids: string[] = [];
        const fail = (message: string, code = 'INVALID_EDIT'): never => Input.fail(path, message, code);
        const measure = (id: unknown) => {
          const result = candidate.outline.find(block => block.id === id && block.type === 'measure');
          if (!result || result.type !== 'measure') return fail(`Measure not found: ${id}.`, 'TARGET_NOT_FOUND');
          return result;
        };
        const insertionIndex = () => {
          if ((op.beforeMeasureId !== undefined) === (op.afterBlockId !== undefined)) fail('Specify exactly one of beforeMeasureId or afterBlockId.');
          if (op.beforeMeasureId !== undefined) return candidate.outline.indexOf(measure(op.beforeMeasureId));
          const index = candidate.outline.findIndex(block => block.id === op.afterBlockId);
          if (index < 1) fail('afterBlockId must identify a block after the initial values.', 'TARGET_NOT_FOUND');
          return index + 1;
        };
        const element = (id: unknown) => {
          for (const block of candidate.outline) if (block.type === 'measure') for (const staff of ['upperStaff', 'lowerStaff'] as const)
            for (const voice of block.data[staff].voices) for (const entry of ScoreVoice.flatten(voice, block.data.length))
              if (entry.element.id === id) return { item: entry.element, block, staff, voice, entry };
          return fail(`Element not found: ${id}.`, 'TARGET_NOT_FOUND');
        };
        const note = (id: unknown) => {
          const target = element(id);
          if (target.item.kind !== 'note') return fail(`Expected a pitched note: ${id}.`);
          return { ...target, item: target.item as PianoNote };
        };
        const position = () => {
          const value = op.position as { measureId: string; offset: { numerator: number; denominator: number } };
          const block = measure(value.measureId);
          const offset = MusicalTime.multiply(MusicalTime.create(value.offset.numerator, value.offset.denominator), MusicalTime.create(4));
          const limit = MusicalTime.create(block.data.length.cnt * 16, block.data.length.unit);
          const atEnd = MusicalTime.compare(offset, limit) === 0;
          if (MusicalTime.compare(offset, limit) > 0 || atEnd && (!type.startsWith('remove_') && op.action !== 'stop' || candidate.outline.filter(b => b.type === 'measure').at(-1)?.id !== block.id))
            fail('Position must lie inside its measure; only a stop may use the score end.');
          return { block, offset };
        };

        if (type === 'create_score' || type === 'append_measures' || type === 'insert_measures') {
          const oldIds = new Set(candidate.outline.map(block => block.id));
          let next;
          if (type === 'insert_measures') {
            if (Object.keys(nextState.pending).length) fail('Resolve pending construction ties before inserting measures.');
            const anchorIndex = op.afterMeasureId === null ? 1 : candidate.outline.indexOf(measure(op.afterMeasureId));
            const key = ScoreKey.forBlock(candidate.outline, candidate.outline[anchorIndex].id);
            const scratch: ScoreProject = { outline: [
              { ...candidate.outline[0], data: { ...candidate.outline[0].data, keySignature: key } }, { ...candidate.outline[1] },
            ] };
            next = Authoring.apply(scratch, Authoring.createState(), [{ type: 'append_measures', measures: op.measures }], false);
            candidate.outline.splice(anchorIndex + 1, 0, ...next.project.outline.slice(2));
            if (Object.keys(next.state.pending).length) fail('Insert complete measures; connect boundary ties with set_tie.');
          } else {
            next = Authoring.apply(candidate, nextState, [op], false);
            candidate = next.project;
            nextState = next.state;
          }
          addedMeasures += next.summary.addedMeasures;
          addedNotes += next.summary.addedNotes;
          if (addedMeasures > 32) fail('At most 32 new measures per batch.', 'REQUEST_LIMIT');
          if (candidate.outline.filter(block => block.type === 'measure').length > 512) fail('Measure additions are limited to scores of at most 512 measures.', 'REQUEST_LIMIT');
          ids.push(...candidate.outline.filter(block => !oldIds.has(block.id)).map(block => block.id));
        } else if (type === 'remove_measures') {
          const removed = new Set(op.measureIds as string[]);
          for (const id of removed) { measure(id); ids.push(id); }
          candidate.outline = candidate.outline.filter(block => !removed.has(block.id)) as ScoreProject['outline'];
        } else if (type === 'replace_voice' || type === 'remove_voice') {
          const block = measure(op.measureId), staff = op.staff as PianoStaffName, index = op.voiceIndex as number;
          const voices = block.data[staff].voices;
          if (index > voices.length || type === 'remove_voice' && index >= voices.length) fail('Voice index not found.', 'TARGET_NOT_FOUND');
          if (type === 'remove_voice') {
            if (voices.length === 1) fail('A staff must retain at least one voice.');
            voices.splice(index, 1);
          } else {
            const ties = new Set<string>();
            const built = Authoring.staff([op.events], ScoreKey.forBlock(candidate.outline, block.id), block.data.length, `${path}.events`, ties).voices[0];
            if (ties.size) fail('Use set_tie after reading the new IDs from get_score_range.');
            let suffix = index;
            while (!voices[index] && voices.some(v => v.id === `voice-${suffix}`)) suffix++;
            built.id = voices[index]?.id ?? `voice-${suffix}`;
            voices.splice(index, index === voices.length ? 0 : 1, built);
            for (const entry of ScoreVoice.flatten(built, block.data.length)) ids.push(entry.element.id);
          }
          ids.push(block.id);
        } else if (type === 'set_pitches') {
          const target = note(op.noteId), previous = target.item.pitches;
          const pitches = (op.pitches as string[]).map((pitch, i) => Input.pitch(pitch, ScoreKey.forBlock(candidate.outline, target.block.id), `${path}.pitches[${i}]`));
          if (new Set(pitches.map(pitch => pitch.midi)).size !== pitches.length) fail('Duplicate pitches.');
          target.item.pitches = pitches.map(pitch => ({ ...previous.find(old => old.midi === pitch.midi), ...pitch,
            spellingDirection: pitch.spellingDirection })).sort((a, b) => b.midi - a.midi);
          ids.push(target.item.id);
        } else if (type === 'set_value') {
          const target = element(op.elementId);
          if (target.item.kind === 'measure-rest') fail('Replace the voice to change a whole-measure rest.');
          else target.item.value = Input.noteValue(op.value, `${path}.value`);
          ids.push(target.item.id);
        } else if (type === 'set_rest') {
          const target = note(op.noteId), old = target.item;
          const replacement = { id: old.id, kind: 'rest' as const, value: old.value };
          if (target.entry.tuplet) target.entry.tuplet.elements[target.entry.childIndex] = replacement;
          else target.voice.elements[target.entry.index] = replacement;
          ids.push(old.id);
        } else if (type === 'set_grace_notes') {
          const target = note(op.noteId);
          const children = op.notes as { id?: string; value: string; pitch: string; slash: boolean; fingering?: PianoFingering; substitutionFingering?: PianoFingering }[];
          if (children.length) {
            const oldIds = new Set(target.item.beforeGraceNotes?.map(grace => grace.id));
            target.item.beforeGraceNotes = children.map((child, i) => {
              if (child.id && !oldIds.has(child.id)) fail('A grace ID must already belong to the principal note.');
              return { id: child.id ?? crypto.randomUUID(), value: Input.noteValue(child.value, `${path}.notes[${i}].value`),
                pitches: [{ ...Input.pitch(child.pitch, ScoreKey.forBlock(candidate.outline, target.block.id), `${path}.notes[${i}].pitch`),
                  ...(child.fingering ? { fingering: child.fingering } : {}), ...(child.substitutionFingering ? { substitutionFingering: child.substitutionFingering } : {}) }], slash: child.slash };
            });
            for (const grace of target.item.beforeGraceNotes) {
              const pitch = grace.pitches[0];
              if (pitch.substitutionFingering !== undefined || pitch.fingering !== undefined && !ScoreFingerings.allows(
                ScoreFingerings.rules(target.item, 0, grace.id), pitch.fingering,
              )) fail('Grace notes cannot use substitution or a finger already used by a related pitch.');
            }
            if (op.performance) target.item.gracePerformance = op.performance as GracePerformanceSettings;
            else delete target.item.gracePerformance;
          } else { delete target.item.beforeGraceNotes; delete target.item.gracePerformance; }
          ids.push(target.item.id);
        } else if (type === 'set_note_expression') {
          const target = note(op.noteId);
          if (!('staccato' in op) && !('accent' in op) && !('fermata' in op) && !('arpeggio' in op)) fail('Provide at least one expression field.');
          if ('staccato' in op) { if (op.staccato === null) delete target.item.staccato; else target.item.staccato = op.staccato as StaccatoSettings; }
          if ('accent' in op) {
            if (op.accent === null) delete target.item.accent;
            else {
              if (target.item.tieFrom) fail('Accent is unavailable on a note tied from a preceding note.');
              target.item.accent = op.accent as NonNullable<typeof target.item.accent>;
            }
          }
          if ('arpeggio' in op) { if (op.arpeggio === null) delete target.item.arpeggio; else target.item.arpeggio = op.arpeggio as ArpeggioSettings; }
          if ('fermata' in op) {
            if (op.fermata === null) delete target.item.fermata;
            else {
              if (target.item.tieTo) fail('Fermata is available only on the last note of the tie chain.');
              target.item.fermata = op.fermata as NonNullable<typeof target.item.fermata>;
              reappliedFermatas.add(target.item.id);
            }
          }
          ids.push(target.item.id);
        } else if (type === 'set_fingering') {
          const target = note(op.noteId);
          const grace = op.graceNoteId === undefined ? undefined : target.item.beforeGraceNotes?.find(child => child.id === op.graceNoteId);
          if (op.graceNoteId !== undefined && !grace) fail('Grace note not found.', 'TARGET_NOT_FOUND');
          const pitch = (grace?.pitches ?? target.item.pitches)[op.pitchIndex as number];
          if (!pitch) fail('Pitch index not found.', 'TARGET_NOT_FOUND');
          if (op.fingering !== null && !ScoreFingerings.allows(
            ScoreFingerings.rules(target.item, op.pitchIndex as number, grace?.id),
            op.fingering as PianoFingering, (op.substitutionFingering ?? undefined) as PianoFingering | undefined,
          )) fail('Fingering is already used by a related pitch, or substitution is not allowed.');
          candidate = NotePitches.setFingering(candidate, {
            noteId: target.item.id, staff: target.staff, pitchIndex: op.pitchIndex as number,
            graceNoteId: grace?.id,
          }, op.fingering as PianoFingering | null, (op.substitutionFingering ?? undefined) as PianoFingering | undefined);
          ids.push(target.item.id);
        } else if (type === 'set_tie') {
          const source = note(op.fromNoteId).item;
          if (source.tieTo) { const old = note(source.tieTo).item; if (old.tieFrom === source.id) delete old.tieFrom; delete source.tieTo; }
          for (const [scope, id] of Object.entries(nextState.pending)) if (id === source.id) delete nextState.pending[scope];
          if (op.toNoteId !== null) {
            const target = note(op.toNoteId).item;
            if (target.tieFrom && target.tieFrom !== source.id) fail('Detach the existing incoming tie first.');
            source.tieTo = target.id; target.tieFrom = source.id;
            ids.push(target.id);
          }
          ids.push(source.id);
        } else if (type === 'set_slur') {
          note(op.startNoteId); note(op.endNoteId);
          if (op.slurId) {
            if (!candidate.slurs?.some(span => span.id === op.slurId)) fail('Slur not found.', 'TARGET_NOT_FOUND');
            candidate.slurs = candidate.slurs!.filter(span => span.id !== op.slurId);
          }
          const availability = ScoreSlur.availability(candidate, [op.startNoteId as string, op.endNoteId as string]);
          if (!availability.canAdd || availability.firstId !== op.startNoteId || availability.lastId !== op.endNoteId) fail(availability.addReason || 'Slur endpoints must be in score order.');
          const id = op.slurId as string || crypto.randomUUID();
          (candidate.slurs ??= []).push({ id, startNoteId: op.startNoteId as string, endNoteId: op.endNoteId as string });
          ids.push(id);
        } else if (type === 'remove_slur') {
          if (!candidate.slurs?.some(span => span.id === op.slurId)) fail('Slur not found.', 'TARGET_NOT_FOUND');
          candidate.slurs = candidate.slurs!.filter(span => span.id !== op.slurId); ids.push(op.slurId as string);
        } else if (type === 'set_trill') {
          note(op.noteId);
          if (!ScoreTrill.canApply(candidate, op.noteId as string)) fail('A trill requires a single note or a same-pitch tie chain.');
          candidate = ScoreTrill.set(candidate, op.noteId as string, op.settings === null ? undefined : op.settings as TrillSettings);
          ids.push(op.noteId as string);
        } else if (type.includes('pedal_event') || type.includes('ottava_event')) {
          const { block, offset } = position();
          const ottava = type.includes('ottava'), key = ottava ? 'ottavaEvents' : 'pedalEvents';
          const existing = (block.data[key] ?? []).find(event => MusicalTime.compare(event.offset, offset) === 0 && (!ottava || 'staff' in event && event.staff === op.staff));
          if (type.startsWith('remove_')) {
            if (!existing) fail('Event not found.', 'TARGET_NOT_FOUND');
            if (ottava) block.data.ottavaEvents = block.data.ottavaEvents!.filter(event => event.id !== existing!.id);
            else block.data.pedalEvents = block.data.pedalEvents!.filter(event => event.id !== existing!.id);
            ids.push(existing!.id);
          } else {
            const id = existing?.id ?? crypto.randomUUID();
            if (ottava) block.data.ottavaEvents = [...(block.data.ottavaEvents ?? []).filter(event => event.id !== id), { id, offset, staff: op.staff as PianoStaffName, action: op.action as 'start' | 'stop' }];
            else block.data.pedalEvents = [...(block.data.pedalEvents ?? []).filter(event => event.id !== id), { id, offset, action: op.action as 'start' | 'change' | 'stop' }];
            block.data[key]!.sort((a, b) => MusicalTime.compare(a.offset, b.offset));
            ids.push(id);
          }
        } else if (type === 'set_dynamic_change') {
          const target = note(op.noteId);
          if (!ScoreDynamics.anchors(candidate).some(anchor => anchor.noteId === target.item.id)) fail('Dynamics require an upper-staff voice-1 written note.');
          if (op.level !== null && !ScoreDynamics.isLevel(op.level)) fail('Invalid dynamic level.');
          if (op.level !== null && !ScoreDynamics.isVelocity(op.velocity)) fail('Invalid dynamic velocity (1–127).');
          candidate = ScoreDynamics.set(candidate, target.item.id, op.level as DynamicLevel | null, op.velocity as number);
          ids.push(target.item.id);
        } else if (type === 'set_tempo_change' || type === 'set_clef_change') {
          note(op.noteId);
          if (type === 'set_tempo_change') {
            if (!ScoreTempo.anchors(candidate).some(anchor => anchor.noteId === op.noteId)) fail('Tempo changes require an upper-staff voice-1 note.');
            candidate = ScoreTempo.set(candidate, op.noteId as string, op.bpm as number | null);
          } else {
            if (!ScoreClef.anchors(candidate).some(anchor => anchor.noteId === op.noteId)) fail('Clef changes require a voice-1 note.');
            candidate = ScoreClef.set(candidate, op.noteId as string, op.clef as 'treble' | 'bass' | null);
          }
          ids.push(op.noteId as string);
        } else if (type === 'set_initial_values') {
          const settings = op.settings as { meter: [number, number]; keyFifths: number; tempo: number };
          if (![1, 2, 4, 8, 16, 32, 64].includes(settings.meter[1])) fail('Meter denominator must be a power of two from 1 to 64.');
          candidate.outline[0].data = { timeSignature: { cnt: settings.meter[0], unit: settings.meter[1] }, keySignature: { fifths: settings.keyFifths as KeySignature['fifths'] }, tempo: settings.tempo };
          ids.push(candidate.outline[0].id);
        } else if (type === 'set_measure_length') {
          const block = measure(op.measureId), pair = op.length as [number, number];
          block.data.length = { cnt: pair[0], unit: pair[1] }; ids.push(block.id);
        } else if (type === 'set_key_change') {
          if ([op.beforeMeasureId, op.afterBlockId, op.keyChangeId].filter(value => value !== undefined).length !== 1)
            fail('Specify exactly one of beforeMeasureId, afterBlockId, or keyChangeId.');
          const index = op.keyChangeId !== undefined ? candidate.outline.findIndex(block => block.id === op.keyChangeId && block.type === 'key-change')
            : insertionIndex();
          if (index < 0) fail('Key change not found.', 'TARGET_NOT_FOUND');
          const targetIndex = op.keyChangeId !== undefined ? index : op.beforeMeasureId !== undefined ? index - 1 : index;
          const previous = candidate.outline[targetIndex];
          if (op.keyFifths === null) {
            if (previous?.type !== 'key-change') fail('No key-change block at the requested anchor.', 'TARGET_NOT_FOUND');
            candidate.outline.splice(targetIndex, 1); ids.push(previous.id);
          } else if (previous?.type === 'key-change') { previous.data.keySignature.fifths = op.keyFifths as KeySignature['fifths']; ids.push(previous.id); }
          else { const id = crypto.randomUUID(); candidate.outline.splice(index, 0, { id, type: 'key-change', data: { keySignature: { fifths: op.keyFifths as KeySignature['fifths'] } } }); ids.push(id); }
        } else if (type === 'insert_section') {
          const index = insertionIndex(), id = crypto.randomUUID();
          candidate.outline.splice(index, 0, { id, type: 'section', data: { name: op.name as string } }); ids.push(id);
        } else if (type === 'rename_section' || type === 'remove_section') {
          const block = candidate.outline.find(block => block.type === 'section' && block.id === op.sectionId);
          if (!block || block.type !== 'section') fail('Section not found.', 'TARGET_NOT_FOUND');
          else if (type === 'rename_section') block.data.name = op.name as string;
          else { if (candidate.outline.indexOf(block) === 1) fail('The first section is required.'); candidate.outline.splice(candidate.outline.indexOf(block), 1); }
          ids.push(op.sectionId as string);
        } else fail(`Unsupported operation: ${type}.`);
        ids.forEach(id => changedIds.add(id));
        results.push({ type, ids });
      } catch (error) {
        if (error instanceof AuthoringError && operationIndex !== 0 && error.message.startsWith('operations[0]'))
          error.message = error.message.replace('operations[0]', path);
        throw error;
      }
    });
    // Validate metrical structure before deriving timing from a possibly multi-operation edit.
    Authoring.validate(candidate, nextState, false);
    candidate = ScoreFermata.reconcileCaptured(fermataTiming, candidate, reappliedFermatas);
    candidate = ScoreDynamics.reconcile(candidate);
    Integrity.validate(candidate);
    return { project: candidate, state: nextState, summary: { addedMeasures, addedNotes, measureCount: candidate.outline.filter(b => b.type === 'measure').length,
      unresolvedTies: Object.keys(nextState.pending).length, changedIds: [...changedIds], ...Impact.compare(project, candidate), operations: results } };
  }
}
export default ScoreEditing;
