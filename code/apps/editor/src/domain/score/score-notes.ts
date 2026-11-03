import type { ScoreProject,PianoNote,PianoRest,PianoStaffName,OutlineBlock } from './types.ts';
import ScoreVoice from './score-voice.ts';
import ScoreTimeline from './score-timeline.ts';
import VoiceCollision from './voice-collision.ts';
namespace ScoreNotes {
  export function map(project: ScoreProject,ids: ReadonlySet<string>,update: (note: PianoNote) => PianoNote|PianoRest,staff: PianoStaffName): ScoreProject {
    return {
      ...project,outline: project.outline.map((block) => block.type!=='measure'? block:{
        ...block,data: {
          ...block.data,[staff]: {
            ...block.data[staff],
            voices: block.data[staff].voices.map((voice) => ScoreVoice.mapNotes(voice,(note) => ids.has(note.id)? update(note):note)),
          }
        },
      }) as ScoreProject['outline']
    };
  }

  /** Validate only edited notes, so unrelated pre-existing conflicts do not block an edit. */
  export function collides(
    previous: readonly OutlineBlock[],next: readonly OutlineBlock[],staff: PianoStaffName,ids: ReadonlySet<string>,
  ): boolean {
    const spans=ScoreTimeline.allNotes(next,staff).filter(({ note }) => ids.has(note.id)).map((entry) => ({
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
