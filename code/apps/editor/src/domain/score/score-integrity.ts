import Input from './score-authoring-input.ts';
import Validator from './score-project-validator.ts';
import ScoreVoice from './score-voice.ts';
import ScoreFermata from './score-fermata.ts';
import ScoreSlur from './score-slur.ts';
import ScoreTrill from './score-trill.ts';
import ScoreArpeggio from './score-arpeggio.ts';
import ScoreTempo from './score-tempo.ts';
import ScoreClef from './score-clef.ts';
import ScoreDynamics from './score-dynamics.ts';
import MusicalTime from '../theory/musical-time.ts';
import type { ScoreProject } from './types.ts';

namespace ScoreIntegrity {
  export function validate(project: ScoreProject) {
    const fail = (message: string): never => Input.fail('project', message, 'INVALID_SCORE');
    if (!Validator.isValid(project)) fail('Invalid score structure or voice duration.');
    if (ScoreFermata.hasConflicts(project)) fail('Overlapping fermatas must have the same absolute end position.');
    const ids = new Set<string>();
    const add = (id: string) => { if (ids.has(id)) fail(`Duplicate element or expression ID: ${id}.`); ids.add(id); };
    const events = new Map<string, { position: ReturnType<typeof MusicalTime.create>; action: string; id: string }[]>();
    const measures = project.outline.filter(block => block.type === 'measure');
    let start = MusicalTime.create(0);
    for (const block of project.outline) {
      add(block.id);
      if (block.type !== 'measure') continue;
      const length = MusicalTime.create(block.data.length.cnt * 16, block.data.length.unit);
      for (const staff of [block.data.upperStaff, block.data.lowerStaff]) {
        if (new Set(staff.voices.map(voice => voice.id)).size !== staff.voices.length) fail(`Duplicate voice ID in ${block.id}.`);
        for (const voice of staff.voices) {
          for (const item of voice.elements) if (item.kind === 'tuplet') add(item.id);
          for (const { element: item } of ScoreVoice.flatten(voice, block.data.length)) {
            add(item.id);
            if (item.kind !== 'note') continue;
            if (item.pitches.some((pitch, i) => i > 0 && pitch.midi >= item.pitches[i - 1].midi)) fail(`Pitches must be unique and descending: ${item.id}.`);
            for (const pitch of item.pitches) if (pitch.substitutionFingering && pitch.substitutionFingering === pitch.fingering) fail(`Substitution fingering must differ: ${item.id}.`);
            if (item.staccato && item.arpeggio) fail(`Staccato and arpeggio are mutually exclusive: ${item.id}.`);
            if (item.fermata && (!ScoreFermata.validate(item.fermata) || !ScoreFermata.canApply(item))) fail(`Fermata requires a valid ratio and the last tied segment: ${item.id}.`);
            if (item.accent && (!Number.isInteger(item.accent.velocityOffset) || item.accent.velocityOffset < 0 || item.accent.velocityOffset > 50)) fail(`Invalid accent offset: ${item.id}.`);
            if (item.staccato && (!ScoreArpeggio.isTenthInRange(item.staccato.lengthRatio, 0.1, 0.9) || item.tieTo)) fail(`Staccato requires a valid ratio and the last tied segment: ${item.id}.`);
            if (item.arpeggio && (!ScoreArpeggio.validate(item.arpeggio) || !ScoreArpeggio.canApply(item))) fail(`Invalid arpeggio target or settings: ${item.id}.`);
            if (item.beforeGraceNotes?.length && (item.pitches.length !== 1 || item.value.type === '32nd')) fail(`Grace notes require a single principal note longer than a 32nd: ${item.id}.`);
            for (const grace of item.beforeGraceNotes ?? []) {
              add(grace.id);
              for (const pitch of grace.pitches) if (pitch.substitutionFingering && pitch.substitutionFingering === pitch.fingering) fail(`Invalid grace fingering: ${grace.id}.`);
            }
            if (item.gracePerformance && (!ScoreArpeggio.isTenthInRange(item.gracePerformance.spreadRatio, 0.1, 1) ||
              !ScoreArpeggio.isTenthInRange(item.gracePerformance.timing, 0, 1))) fail(`Invalid grace performance: ${item.id}.`);
          }
        }
      }
      for (const event of [...(block.data.pedalEvents ?? []), ...(block.data.ottavaEvents ?? [])]) {
        add(event.id);
        const offset = event.offset;
        if (offset.denominator <= 0 || offset.numerator < 0 || MusicalTime.compare(offset, length) > 0 ||
          MusicalTime.compare(offset, length) === 0 && (block.id !== measures.at(-1)!.id || event.action !== 'stop')) fail(`Invalid time event position: ${event.id}.`);
        const scope = 'staff' in event ? `ottava:${event.staff}` : 'pedal';
        const list = events.get(scope) ?? [];
        list.push({ position: MusicalTime.add(start, offset), action: event.action, id: event.id }); events.set(scope, list);
      }
      start = MusicalTime.add(start, length);
    }
    for (const [scope, list] of events) {
      list.sort((a, b) => MusicalTime.compare(a.position, b.position));
      let active = false;
      list.forEach((event, index) => {
        if (index && MusicalTime.compare(event.position, list[index - 1].position) === 0) fail(`Duplicate ${scope} position: ${event.id}.`);
        if (event.action === 'start' ? active : !active) fail(`Orphaned or repeated ${scope} event: ${event.id}. Update related events explicitly.`);
        active = event.action !== 'stop';
      });
    }
    const slurs = ScoreSlur.ranges(project);
    if (slurs.length !== (project.slurs?.length ?? 0)) fail('A slur endpoint was removed or moved outside its voice. Remove or retarget the slur explicitly.');
    for (const slur of slurs) add(slur.id);
    for (let i = 0; i < slurs.length; i++) for (let j = i + 1; j < slurs.length; j++)
      if (slurs[i].members.some(entry => slurs[j].members.some(other => entry.note.id === other.note.id))) fail('Overlapping slurs are not supported.');
    const trillTargets = new Set<string>();
    for (const trill of project.trills ?? []) {
      add(trill.id);
      const chain = ScoreTrill.chain(project, trill.startNoteId);
      if (trill.settings.fingerings && chain.some(note => note.pitches.some(pitch => pitch.fingering !== undefined || pitch.substitutionFingering !== undefined)))
        fail(`Trill fingerings belong to its attack sequence, without pitch fingerings or substitutions: ${trill.id}.`);
      if (!ScoreTrill.validate(trill.settings) || !ScoreTrill.canApply(project, trill.startNoteId) || chain[0]?.id !== trill.startNoteId ||
        chain.at(-1)?.id !== trill.endNoteId || trillTargets.has(trill.startNoteId)) fail(`Invalid trill reference or settings: ${trill.id}.`);
      trillTargets.add(trill.startNoteId);
    }
    if (ScoreTempo.changes(project).length !== (project.tempoChanges?.length ?? 0)) fail('Invalid tempo anchor. Remove or retarget it explicitly.');
    if (!ScoreDynamics.isValid(project)) fail('Invalid or duplicate dynamics anchor or level.');
    if (ScoreClef.changes(project).length !== (project.clefChanges?.length ?? 0)) fail('Invalid clef anchor. Remove or retarget it explicitly.');
    if (new Set(project.tempoChanges?.map(change => change.noteId)).size !== (project.tempoChanges?.length ?? 0)) fail('Duplicate tempo anchors.');
    if (new Set(project.clefChanges?.map(change => change.noteId)).size !== (project.clefChanges?.length ?? 0)) fail('Duplicate clef anchors.');
  }
}
export default ScoreIntegrity;
