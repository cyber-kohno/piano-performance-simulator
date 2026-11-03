import type { ScoreProject,OutlineBlock,PianoStaffName,PianoNote,NoteValue } from './types.ts';
import ScoreTimeline from './score-timeline.ts';
import ScoreVoice from './score-voice.ts';
import ScoreNotes from './score-notes.ts';

import WrittenValue from '../theory/written-value.ts';

import NotationGrid from './notation-grid.ts';
import RestSpelling from './rest-spelling.ts';
import type { VoiceScope,NoteTimeResult } from './note-target.ts';
import PianoPitchRules from './piano-pitch-rules.ts';
namespace NotePlacement {
  export function restAt(outline: readonly OutlineBlock[],position: number,value: NoteValue,staff: PianoStaffName,voiceIndex: number) {
    if(!NotationGrid.contains(position)||position<0) return undefined;
    const length=WrittenValue.sixteenths(value);
    if(!NotationGrid.contains(length)||length<0.5) return undefined;
    const location=ScoreTimeline.measureAt(outline,position);
    if(!location) return undefined;
    const local=position-location.startSixteenths;
    if(local+length>location.lengthSixteenths) return undefined;
    const voice=location.measure.data[staff].voices[voiceIndex];
    if(!voice) return undefined;
    const entries=ScoreVoice.locate(voice,location.measure.data.length).filter((entry) =>
      entry.positionSixteenths<local+length&&entry.positionSixteenths+entry.lengthSixteenths>local,
    );
    if(!entries.length||entries.some(({ element }) => element.kind!=='rest'&&element.kind!=='measure-rest')) return undefined;
    const first=entries[0];
    const last=entries[entries.length-1];
    if(first.positionSixteenths>local||last.positionSixteenths+last.lengthSixteenths<local+length) return undefined;
    return { location,voice,first,last,local,length };
  }
  export function add(project: ScoreProject,target: VoiceScope,position: number,value: NoteValue,pitch: number): NoteTimeResult|undefined {
    const staff=target.staff;
    const destination=restAt(project.outline,position,value,target.staff,target.voiceIndex);
    if(!destination||!Number.isInteger(pitch)||pitch<PianoPitchRules.min||pitch>PianoPitchRules.max) return undefined;
    const { location,voice,first,last,local,length }=destination;
    const usedIds=new Set(project.outline.flatMap((block) => block.type!=='measure'? []:
      [block.data.upperStaff,block.data.lowerStaff].flatMap((staff) => staff.voices.flatMap((voice) => ScoreVoice.flatten(voice,block.data.length).map(({ element }) => element.id))),
    ));
    let number=1;
    while(usedIds.has(`note-${number}`)) number+=1;
    const note: PianoNote={ id: `note-${number}`,kind: 'note',value: { ...value },pitches: [{ midi: pitch }] };
    const elements=[
      ...voice.elements.slice(0,first.index),
      ...RestSpelling.create(first.positionSixteenths,local-first.positionSixteenths),
      note,
      ...RestSpelling.create(local+length,last.positionSixteenths+last.lengthSixteenths-local-length),
      ...voice.elements.slice(last.index+1),
    ];
    const outline=project.outline.map((block) => block.id!==location.measure.id||block.type!=='measure'? block:{
      ...block,data: {
        ...block.data,[staff]: {
          ...block.data[staff],
          voices: block.data[staff].voices.map((voice,index) => index!==target.voiceIndex? voice:{ ...voice,elements }),
        }
      },
    }) as ScoreProject['outline'];
    if(ScoreNotes.collides(project.outline,outline,staff,new Set([note.id]))) return undefined;
    return {
      project: { ...project,outline },
      position,pitch,noteId: note.id,pitchIndex: 0,
    };
  }

}
export default NotePlacement;
