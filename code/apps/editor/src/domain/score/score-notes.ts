import type { ScoreProject,PianoNote,PianoRest,PianoStaffName,OutlineBlock } from './types.ts';
import ScoreVoice from './score-voice.ts';
import ScoreTimeline from './score-timeline.ts';
import VoiceCollision from './voice-collision.ts';
namespace ScoreNotes {
  export function map(project: ScoreProject,ids: ReadonlySet<string>,update: (note: PianoNote) => PianoNote|PianoRest,staff: PianoStaffName): ScoreProject {
    if (!ids.size) return project;
    const measures = ScoreTimeline.isPrepared(project.outline) ? new Set([...ids].flatMap(id => {
      const entry = ScoreTimeline.note(project.outline, id, staff); return entry ? [entry.measure.id] : [];
    })) : undefined;
    const outline = project.outline.map(block => {
      if (block.type !== 'measure') return block;
      if (measures && !measures.has(block.id)) return block;
      const current = block.data[staff];
      const voices = current.voices.map(voice => ScoreVoice.mapNotes(voice, note => ids.has(note.id) ? update(note) : note));
      if (voices.every((voice, index) => voice === current.voices[index])) return block;
      return { ...block, data: { ...block.data, [staff]: { ...current, voices } } };
    }) as ScoreProject['outline'];
    return outline.every((block, index) => block === project.outline[index]) ? project : { ...project, outline };
  }

  /** Validate only edited notes, so unrelated pre-existing conflicts do not block an edit. */
  export function collides(
    previous: readonly OutlineBlock[],next: readonly OutlineBlock[],staff: PianoStaffName,ids: ReadonlySet<string>,
  ): boolean {
    const spans=[...ids].flatMap(id => { const entry = ScoreTimeline.note(next, id, staff); return entry ? [entry] : []; }).map((entry) => ({
      staff,
      voiceId: entry.measure.data[staff].voices[entry.voiceIndex].id,
      startSixteenths: entry.measureStartSixteenths+entry.positionSixteenths,
      lengthSixteenths: entry.lengthSixteenths,
      pitches: entry.note.pitches,
    }));
    return VoiceCollision.exists(previous,spans);
  }

}
export default ScoreNotes;
