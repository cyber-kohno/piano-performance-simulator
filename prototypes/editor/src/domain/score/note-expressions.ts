import type { ScoreProject,PianoStaffName,PianoNote } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreArpeggio from './score-arpeggio.ts';
import ScoreNotes from './score-notes.ts';
namespace NoteExpressions {
  export function set(project: ScoreProject,target: { noteId: string; staff: PianoStaffName },settings: Pick<PianoNote,'staccato'|'arpeggio'>): ScoreProject {
    const selected=ScoreTimeline.note(project.outline,target.noteId,target.staff);
    const { staccato,arpeggio }=settings;
    if(!selected||(staccato&&arpeggio)) return project;
    if(staccato&&selected.note.tieTo&&(staccato.type!==selected.note.staccato?.type||staccato.lengthRatio!==selected.note.staccato?.lengthRatio)) return project;
    if(arpeggio&&(!ScoreArpeggio.canApply(selected.note)||!ScoreArpeggio.validate(arpeggio))) return project;
    if(staccato&&(!['normal','staccatissimo'].includes(staccato.type)||!Number.isFinite(staccato.lengthRatio)||
      staccato.lengthRatio<0.1||staccato.lengthRatio>0.9||Math.abs(staccato.lengthRatio*10-Math.round(staccato.lengthRatio*10))>1e-8)) return project;
    return ScoreNotes.map(project,new Set([target.noteId]),(note) => {
      const { staccato: previous,arpeggio: previousArpeggio,...rest }=note;
      return { ...rest,...(staccato? { staccato: { ...staccato } }:{}),...(arpeggio? { arpeggio: { ...arpeggio } }:{}) };
    },target.staff);
  }

}
export default NoteExpressions;
