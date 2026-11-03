import type { ScoreProject,OutlineBlock,PianoStaffName,PianoNote,PianoVoiceElement } from './types.ts';

import ScoreVoice from './score-voice.ts';

import WrittenValue from '../theory/written-value.ts';
import MusicalTime from '../theory/musical-time.ts';

import RestSpelling from './rest-spelling.ts';
import type { VoiceScope } from './note-target.ts';
namespace NoteSpan {
  export type NotePlan={ measureId: string; position: number; note: PianoNote };

  export function hasTuplet(outline: readonly OutlineBlock[],target: VoiceScope,start: number,end: number): boolean {
    let measureStart=0;
    return outline.some((block) => {
      if(block.type!=='measure') return false;
      const offset=measureStart;
      measureStart+=block.data.length.cnt/block.data.length.unit*16;
      const voice=block.data[target.staff].voices[target.voiceIndex];
      return voice&&ScoreVoice.locate(voice,block.data.length).some((entry) => entry.element.kind==='tuplet'&&
        MusicalTime.compareNumbers(offset+entry.positionSixteenths,end)<0&&MusicalTime.compareNumbers(MusicalTime.addNumbers(offset+entry.positionSixteenths,entry.lengthSixteenths),start)>0);
    });
  }

  /** Callers validate that this continuous span contains no unrelated notes. */
  export function rewrite(project: ScoreProject,start: number,end: number,plans: NotePlan[],staff: PianoStaffName,voiceIndex: number): ScoreProject {
    let measureStart=0;
    const outline=project.outline.map((block) => {
      if(block.type!=='measure') return block;
      const measureLength=block.data.length.cnt/block.data.length.unit*16;
      const localStart=Math.max(0,start-measureStart);
      const localEnd=Math.min(measureLength,end-measureStart);
      measureStart+=measureLength;
      if(localStart>=localEnd) return block;
      const voice=block.data[staff].voices[voiceIndex];
      const entries=ScoreVoice.locate(voice,block.data.length).filter((entry) =>
        entry.positionSixteenths<localEnd&&entry.positionSixteenths+entry.lengthSixteenths>localStart,
      );
      const first=entries[0];
      const last=entries[entries.length-1];
      const replacements: PianoVoiceElement[]=[];
      let position=first.positionSixteenths;
      for(const plan of plans.filter((plan) => plan.measureId===block.id)) {
        replacements.push(...RestSpelling.create(position,plan.position-position),plan.note);
        position=plan.position+WrittenValue.sixteenths(plan.note.value);
      }
      replacements.push(...RestSpelling.create(position,last.positionSixteenths+last.lengthSixteenths-position));
      const elements=[...voice.elements.slice(0,first.index),...replacements,...voice.elements.slice(last.index+1)];
      return {
        ...block,data: {
          ...block.data,[staff]: {
            ...block.data[staff],
            voices: block.data[staff].voices.map((voice,index) => index!==voiceIndex? voice:{ ...voice,elements }),
          }
        }
      };
    }) as ScoreProject['outline'];
    return { ...project,outline };
  }

}
export default NoteSpan;
