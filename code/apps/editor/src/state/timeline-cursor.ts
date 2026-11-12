import ScoreStaff from '../domain/score/score-staff.ts';
import NoteContinuation from '../domain/score/note-continuation.ts';
import NotePlacement from '../domain/score/note-placement.ts';
import NoteDuration from '../domain/score/note-duration.ts';
import NoteMovement from '../domain/score/note-movement.ts';
import NoteDeletion from '../domain/score/note-deletion.ts';
import type { NoteTarget } from '../domain/score/note-target.ts';
import NotePitches from '../domain/score/note-pitches.ts';
import NoteExpressions from '../domain/score/note-expressions.ts';
import PianoPitchRules from '../domain/score/piano-pitch-rules.ts';
import PitchSpelling from '../domain/theory/pitch-spelling.ts';

import VoiceCollision from "../domain/score/voice-collision.ts";

import KeyTheory from "../domain/theory/key-signature.ts";
import MusicalTime from "../domain/theory/musical-time.ts";
import NotationGrid from "../domain/score/notation-grid.ts";
import WrittenValue from "../domain/theory/written-value.ts";
import ScoreTimeline from "../domain/score/score-timeline.ts";
import { type ArpeggioSettings,type StaccatoSettings,type KeySignature,type MeasureBlock,type NoteValue,type OutlineBlock,type PianoNote,type ScoreProject,type PianoStaffName } from "../domain/score/types.ts";
import {
  getTupletContext,
  getTupletContexts,
  getTupletPlacement,
  setTupletNoteValue,
  resizeTupletNote,
  moveTupletSelection,
  isFullTupletSelection,
} from './tuplet-input.ts';

export { convertFocusedTimelineTuplet } from './tuplet-input.ts';
export const MIN_PIANO_PITCH=PianoPitchRules.min;
export const MAX_PIANO_PITCH=PianoPitchRules.max;
export const TIMELINE_CURSOR_UNITS=[
  { key: '1',type: '16th' },
  { key: '2',type: 'eighth' },
  { key: '3',type: 'quarter' },
  { key: '4',type: '32nd' },
] as const;

export const getDiatonicPitchClasses=KeyTheory.pitchClasses;

export type TimelineCursor={
  staff: PianoStaffName;
  /** Local voice index of the current measure and staff; never project data. */
  voiceIndex: number;
  /** Editing position only, measured in sixteenths; never persisted on a note. */
  positionSixteenths: number;
  /** Normal input value, temporarily overridden by the active tuplet's fixed unit. */
  placementValue: NoteValue;
  pitch: number;
  /** Transient movement direction to apply to the next cursor-entered pitch. */
  spellingDirection?: 'up'|'down';
  focusedNoteId: string|null;
  /** Child of focusedNoteId; transient and independent of ordinary time selection. */
  focusedGraceId?: string|null;
  focusedPitchIndex: number|null;
  /** Fixed endpoint of a transient note range, retained after Shift is released. */
  selectionAnchorNoteId: string|null;
};
export type { LocatedTimelineNote } from '../domain/score/score-timeline.ts';
import type { LocatedTimelineNote } from '../domain/score/score-timeline.ts';
function noteTarget(cursor: TimelineCursor): NoteTarget {
  return { noteId: cursor.focusedNoteId!,staff: cursor.staff,voiceIndex: cursor.voiceIndex,pitchIndex: cursor.focusedPitchIndex };
}
export function createTimelineCursor(staff: PianoStaffName='upperStaff'): TimelineCursor {
  return { staff,voiceIndex: 0,positionSixteenths: 0,placementValue: { type: '16th',dots: 0 },pitch: staff==='upperStaff'? 60:48,focusedNoteId: null,focusedPitchIndex: null,selectionAnchorNoteId: null };
}

export function resetTimelineCursorForStaff(
  outline: readonly OutlineBlock[],cursor: TimelineCursor,staff: PianoStaffName,
): TimelineCursor {
  const measure=ScoreTimeline.measureAt(outline,cursor.positionSixteenths);
  return {
    ...createTimelineCursor(staff),
    positionSixteenths: measure?.startSixteenths??cursor.positionSixteenths,
    placementValue: { type: 'quarter',dots: 0 },
  };
}

export function switchTimelineStaff(outline: readonly OutlineBlock[],cursor: TimelineCursor): TimelineCursor {
  const focused=cursor.focusedNoteId? ScoreTimeline.note(outline,cursor.focusedNoteId,cursor.staff):undefined;
  const next={
    ...createTimelineCursor(cursor.staff==='upperStaff'? 'lowerStaff':'upperStaff'),
    positionSixteenths: focused
      ? focused.measureStartSixteenths+focused.positionSixteenths:cursor.positionSixteenths,
    placementValue: { ...cursor.placementValue },
  };
  return alignAfterTupletExit(outline,cursor,next);
}

function alignAfterTupletExit(outline: readonly OutlineBlock[],previous: TimelineCursor,next: TimelineCursor): TimelineCursor {
  const oldGroup=getTupletContext(outline,previous);
  return oldGroup&&!NotationGrid.contains(next.positionSixteenths)&&!getTupletContext(outline,next)
    ? { ...next,positionSixteenths: oldGroup.start }:next;
}

/** Navigation may fall back to voice 1; edits must instead reject a missing voice. */
export function reconcileTimelineCursorVoice(outline: readonly OutlineBlock[],cursor: TimelineCursor): TimelineCursor {
  const location=ScoreTimeline.measureAt(outline,cursor.positionSixteenths);
  return location?.measure.data[cursor.staff].voices[cursor.voiceIndex]
    ? cursor:{ ...cursor,voiceIndex: 0,focusedNoteId: null,focusedPitchIndex: null,selectionAnchorNoteId: null };
}

export function cycleTimelineVoice(outline: readonly OutlineBlock[],cursor: TimelineCursor): TimelineCursor {
  const focused=cursor.focusedNoteId? ScoreTimeline.note(outline,cursor.focusedNoteId,cursor.staff):undefined;
  const positionSixteenths=focused
    ? focused.measureStartSixteenths+focused.positionSixteenths:cursor.positionSixteenths;
  const count=ScoreTimeline.measureAt(outline,positionSixteenths)?.measure.data[cursor.staff].voices.length;
  if(!count) return cursor;
  return alignAfterTupletExit(outline,cursor,{
    ...cursor,positionSixteenths,voiceIndex: (cursor.voiceIndex+1)%count,
    pitch: focused?.note.pitches[cursor.focusedPitchIndex??0]?.midi??cursor.pitch,
    focusedNoteId: null,focusedPitchIndex: null,selectionAnchorNoteId: null,
  });
}

/** Add only the next local voice, leaving all editing state and other measures intact. */
export function addNextTimelineVoice(project:ScoreProject,cursor:TimelineCursor):ScoreProject {
 const measure=ScoreTimeline.measureAt(project.outline,cursor.positionSixteenths)?.measure;
 return measure?ScoreStaff.addVoice(project,measure.id,cursor.staff,cursor.voiceIndex):project;
}

export function getSelectedTimelineNotes(outline: readonly OutlineBlock[],cursor: TimelineCursor): LocatedTimelineNote[] {
  if(cursor.focusedNoteId===null) return [];
  if (cursor.selectionAnchorNoteId === null && ScoreTimeline.isPrepared(outline)) {
    const focused = ScoreTimeline.note(outline, cursor.focusedNoteId, cursor.staff);
    return focused?.voiceIndex === cursor.voiceIndex ? [focused] : [];
  }
  const notes=ScoreTimeline.notes(outline,cursor.staff,cursor.voiceIndex);
  const focus=notes.findIndex(({ note }) => note.id===cursor.focusedNoteId);
  if(focus<0) return [];
  const anchor=cursor.selectionAnchorNoteId===null? -1
    :notes.findIndex(({ note }) => note.id===cursor.selectionAnchorNoteId);
  return anchor<0? [notes[focus]]:notes.slice(Math.min(anchor,focus),Math.max(anchor,focus)+1);
}

export function extendTimelineNoteSelection(
  outline: readonly OutlineBlock[],cursor: TimelineCursor,direction: -1|1,
): TimelineCursor {
  if(cursor.focusedNoteId===null) return cursor;
  const next=focusAdjacentTimelineNote(outline,cursor,direction);
  if(next.voiceIndex!==cursor.voiceIndex) return cursor;
  if(next.focusedNoteId===cursor.focusedNoteId) return cursor;
  const anchor=cursor.selectionAnchorNoteId??cursor.focusedNoteId;
  return {
    ...next,selectionAnchorNoteId: anchor,
    focusedPitchIndex: next.focusedNoteId===anchor? 0:null,
  };
}

export function collapseTimelineNoteSelection(
  outline: readonly OutlineBlock[],cursor: TimelineCursor,direction: -1|1,
): TimelineCursor {
  const selected=getSelectedTimelineNotes(outline,cursor);
  const target=direction===-1? selected[0]:selected[selected.length-1];
  if(!target) return { ...cursor,selectionAnchorNoteId: null };
  return {
    ...cursor,selectionAnchorNoteId: null,focusedNoteId: target.note.id,focusedPitchIndex: 0,
    positionSixteenths: target.measureStartSixteenths+target.positionSixteenths,
    pitch: target.note.pitches[0].midi,
  };
}
export function setTimelineCursorUnit(cursor: TimelineCursor,key: string): TimelineCursor {
  const unit=TIMELINE_CURSOR_UNITS.find((unit) => unit.key===key);
  if(!unit) return cursor;
  const dots=unit.type==='quarter'&&cursor.placementValue.type==='quarter'? cursor.placementValue.dots:0;
  if(cursor.placementValue.type===unit.type&&cursor.placementValue.dots===dots) return cursor;
  return { ...cursor,placementValue: { type: unit.type,dots } };
}

export function getTimelineFixedInputContext(cursor: TimelineCursor,outline: readonly OutlineBlock[]) {
  const context=getTupletContext(outline,cursor);
  if(!context) return undefined;
  const selected=getSelectedTimelineNotes(outline,cursor);
  if(selected.length>1&&(
    selected.some((entry) => entry.tuplet?.id!==context.group.id)||
    isFullTupletSelection(context,new Set(selected.map(({ note }) => note.id)))
  )) return undefined;
  return context;
}
export function getTimelineInputValue(cursor: TimelineCursor,outline: readonly OutlineBlock[]) {
  const context=getTimelineFixedInputContext(cursor,outline);
  return context? { type: context.group.baseType,dots: 0 } as NoteValue:cursor.placementValue;
}
export function getTimelineInputSixteenths(cursor: TimelineCursor,outline: readonly OutlineBlock[]=[]): number {
  return getTupletContext(outline,cursor)?.step??WrittenValue.sixteenths(cursor.placementValue);
}
export function toggleTimelineCursorDot(cursor: TimelineCursor,outline: readonly OutlineBlock[]=[]): TimelineCursor {
  if(getTupletContext(outline,cursor)||cursor.placementValue.type!=='quarter') return cursor;
  return { ...cursor,placementValue: { ...cursor.placementValue,dots: cursor.placementValue.dots>0? 0:1 } };
}
/** Toggle a tie only between the focused note and the immediately following note. */
export function toggleTieToAdjacentTimelineNote(project:ScoreProject,cursor:TimelineCursor):ScoreProject|undefined {
 return cursor.focusedNoteId?NoteContinuation.toggleAdjacent(project,noteTarget(cursor)):undefined;
}

function getNavigationVoiceIndex(outline: readonly OutlineBlock[],cursor: TimelineCursor,position: number): number {
  let voiceIndex=cursor.voiceIndex;
  let start=0;
  for(const block of outline) {
    if(block.type!=='measure') continue;
    const end=start+block.data.length.cnt/block.data.length.unit*16;
    if(start<=Math.max(position,cursor.positionSixteenths)&&end>Math.min(position,cursor.positionSixteenths)&&
      !block.data[cursor.staff].voices[voiceIndex]) voiceIndex=0;
    start=end;
  }
  return voiceIndex;
}
export function moveTimelineCursorHorizontally(cursor: TimelineCursor,outline: readonly OutlineBlock[],direction: -1|1): TimelineCursor {
  const groups=getTupletContexts(outline,cursor);
  const current=groups.find((group) => direction>0
    ? MusicalTime.compareNumbers(cursor.positionSixteenths,group.start)>=0&&MusicalTime.compareNumbers(cursor.positionSixteenths,group.end)<0
    :MusicalTime.compareNumbers(cursor.positionSixteenths,group.start)>0&&MusicalTime.compareNumbers(cursor.positionSixteenths,group.end)<=0);
  const step=current?.step??WrittenValue.sixteenths(cursor.placementValue);
  let position=MusicalTime.addNumbers(cursor.positionSixteenths,direction*step);
  const boundaries=[0,...groups.flatMap((group) => [group.start,group.end])].filter((boundary) => direction>0
    ? MusicalTime.compareNumbers(boundary,cursor.positionSixteenths)>0&&MusicalTime.compareNumbers(boundary,position)<=0
    :MusicalTime.compareNumbers(boundary,cursor.positionSixteenths)<0&&MusicalTime.compareNumbers(boundary,position)>=0);
  if(boundaries.length) position=direction>0? Math.min(...boundaries):Math.max(...boundaries);
  if(position<0||MusicalTime.compareNumbers(position,ScoreTimeline.length(outline))>=0) return cursor;
  const voiceIndex=getNavigationVoiceIndex(outline,cursor,position);
  return reconcileTimelineCursorVoice(outline,{ ...cursor,voiceIndex,positionSixteenths: position,focusedNoteId: null,focusedPitchIndex: null,selectionAnchorNoteId: null });
}
export function focusAdjacentTimelineNote(outline: readonly OutlineBlock[],cursor: TimelineCursor,direction: -1|1): TimelineCursor {
  const onset=(entry: LocatedTimelineNote) => MusicalTime.addNumbers(entry.measureStartSixteenths,entry.positionSixteenths);
  const measures=outline.filter((block) => block.type==='measure');
  const current=ScoreTimeline.measureAt(outline,cursor.positionSixteenths)?.measure;
  const currentIndex=measures.findIndex((measure) => measure===current);
  const notes: LocatedTimelineNote[]=[];
  const notesByMeasure=new Map<MeasureBlock,LocatedTimelineNote[]>();
  for(const entry of ScoreTimeline.allNotes(outline,cursor.staff)) {
    const entries=notesByMeasure.get(entry.measure)??[];
    entries.push(entry);
    notesByMeasure.set(entry.measure,entries);
  }
  let voiceIndex=cursor.voiceIndex;
  for(let index=currentIndex;index>=0&&index<measures.length;index+=direction) {
    const measure=measures[index];
    if(!measure.data[cursor.staff].voices[voiceIndex]) voiceIndex=0;
    notes.push(...(notesByMeasure.get(measure)??[]).filter((entry) => entry.voiceIndex===voiceIndex&&entry.note.pitches.length>0));
  }
  notes.sort((a,b) => onset(a)-onset(b));
  let target: LocatedTimelineNote|undefined;
  if(cursor.focusedNoteId!==null) {
    const index=notes.findIndex(({ note }) => note.id===cursor.focusedNoteId);
    if(index<0) return cursor;
    target=notes[index+direction];
  } else {
    target=(direction<0? [...notes].reverse():notes).find((entry) => direction<0
      ? MusicalTime.compareNumbers(cursor.positionSixteenths,onset(entry))>0
      :MusicalTime.compareNumbers(cursor.positionSixteenths,MusicalTime.addNumbers(onset(entry),entry.lengthSixteenths))<0);
  }
  return target? {
    ...cursor,voiceIndex: target.voiceIndex,positionSixteenths: onset(target),pitch: target.note.pitches[0].midi,
    focusedNoteId: target.note.id,focusedPitchIndex: 0,selectionAnchorNoteId: null,
  }:cursor.selectionAnchorNoteId===null? cursor:{ ...cursor,selectionAnchorNoteId: null,focusedPitchIndex: 0 };
}
export function findTimelineNoteAtMove(outline: readonly OutlineBlock[],cursor: TimelineCursor,direction: -1|1) {
  const destination=moveTimelineCursorHorizontally(cursor,outline,direction).positionSixteenths;
  const start=Math.min(destination,cursor.positionSixteenths);
  const end=Math.max(destination,cursor.positionSixteenths);
  return ScoreTimeline.allNotes(outline,cursor.staff)
    .sort((a,b) => a.measureStartSixteenths+a.positionSixteenths-b.measureStartSixteenths-b.positionSixteenths)
    .find((entry) => {
      const onset=MusicalTime.addNumbers(entry.measureStartSixteenths,entry.positionSixteenths);
      return MusicalTime.compareNumbers(start,MusicalTime.addNumbers(onset,entry.lengthSixteenths))<0&&MusicalTime.compareNumbers(end,onset)>0&&
        entry.voiceIndex===getNavigationVoiceIndex(outline,cursor,Math.max(start,onset));
    });
}

export function isTimelinePlacementInvalid(outline: readonly OutlineBlock[],cursor: TimelineCursor): boolean {
  if(cursor.focusedNoteId!==null) return false;
  if(getTupletContext(outline,cursor,cursor.positionSixteenths,false)) {
    const target=getTupletPlacement(outline,cursor);
    return !target||VoiceCollision.exists(outline,[{
      staff: cursor.staff,voiceId: target.voice.id,
      startSixteenths: cursor.positionSixteenths,lengthSixteenths: target.length,pitches: [{ midi: cursor.pitch }]
    }]);
  }
  const target=NotePlacement.restAt(outline,cursor.positionSixteenths,cursor.placementValue,cursor.staff,cursor.voiceIndex);
  return !target||VoiceCollision.exists(outline,[{
    staff: cursor.staff,voiceId: target.voice.id,
    startSixteenths: cursor.positionSixteenths,lengthSixteenths: target.length,
    pitches: [{ midi: cursor.pitch }],
  }]);
}

export function addTimelineNoteAt(project:ScoreProject,cursor:TimelineCursor,position=cursor.positionSixteenths,pitch=cursor.pitch) {
 const focusedPitch=cursor.focusedNoteId
   ? ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff)?.note.pitches[cursor.focusedPitchIndex??0]
   : undefined;
 const inputPitch=focusedPitch?.midi??pitch;
 const spellingDirection=focusedPitch ? focusedPitch.spellingDirection : cursor.spellingDirection;
 const result=NoteContinuation.place(project,{staff:cursor.staff,voiceIndex:cursor.voiceIndex},position,cursor.placementValue,inputPitch);
 if(!result) return undefined;
 const nextProject=spellingDirection ? NotePitches.setSpellingDirection(result.project,{ noteId:result.noteId!,staff:cursor.staff,pitchIndex:result.pitchIndex! },spellingDirection) : result.project;
 return {project:nextProject,cursor:{...cursor,positionSixteenths:result.position,pitch:inputPitch,focusedNoteId:result.noteId!,focusedPitchIndex:0,selectionAnchorNoteId:null}};
}
function continueNote(project:ScoreProject,cursor:TimelineCursor,tied:boolean) {
 if(!cursor.focusedNoteId)return undefined;
 const result=NoteContinuation.after(project,noteTarget(cursor),cursor.placementValue,tied);
 return result&&{project:result.project,cursor:{...cursor,positionSixteenths:result.position,pitch:result.pitch!,focusedNoteId:result.noteId!,focusedPitchIndex:result.pitchIndex!,selectionAnchorNoteId:null}};
}
export function appendFocusedTimelineTie(project:ScoreProject,cursor:TimelineCursor) {return continueNote(project,cursor,true);}
export function duplicateFocusedTimelineNoteAfter(project:ScoreProject,cursor:TimelineCursor) {return continueNote(project,cursor,false);}

/** Edit one written value and move only its tied successors, adjusting surrounding rests. */
export function setFocusedTimelineNoteValue(project: ScoreProject,cursor: TimelineCursor,value: NoteValue) {
  if(!cursor.focusedNoteId) return undefined;
  if(getTupletContext(project.outline,cursor)) return setTupletNoteValue(project,cursor,value);
  const result=NoteDuration.setValue(project,noteTarget(cursor),value);
  return result&&{ project: result.project,cursor: { ...cursor,positionSixteenths: result.position } };
}
export function resizeFocusedTimelineNote(project: ScoreProject,cursor: TimelineCursor,direction: -1|1) {
  if(getTupletContext(project.outline,cursor)) return resizeTupletNote(project,cursor,direction);
  if(!cursor.focusedNoteId) return undefined;
  const result=NoteDuration.resize(project,noteTarget(cursor),getTimelineInputSixteenths(cursor,project.outline),direction);
  return result&&{ project: result.project,cursor: { ...cursor,positionSixteenths: result.position } };
}

/** Spelling policy for explicit normalization and normalized tie resizing. */
export function resizeFocusedTimelineTie(
  project: ScoreProject,cursor: TimelineCursor,direction: -1|1,
): { project: ScoreProject; cursor: TimelineCursor }|undefined {
  return rewriteFocusedTimelineTie(project,cursor,direction);
}

export function normalizeFocusedTimelineTie(project: ScoreProject,cursor: TimelineCursor) {
  return rewriteFocusedTimelineTie(project,cursor,0);
}

function rewriteFocusedTimelineTie(project: ScoreProject,cursor: TimelineCursor,direction: -1|0|1) {
  if(!cursor.focusedNoteId) return undefined;
  const result=NoteDuration.normalize(project,noteTarget(cursor),direction,getTimelineInputSixteenths(cursor,project.outline));
  return result&&{ project: result.project,cursor: { ...cursor,positionSixteenths: result.position,focusedNoteId: result.noteId!,selectionAnchorNoteId: null,focusedPitchIndex: result.pitchIndex!,pitch: result.pitch! } };
}

export function setFocusedTimelineNoteType(project: ScoreProject,cursor: TimelineCursor,key: string) {
  const unit=TIMELINE_CURSOR_UNITS.find((unit) => unit.key===key);
  const selected=cursor.focusedNoteId? ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff):undefined;
  return unit&&selected
    ? setFocusedTimelineNoteValue(project,cursor,{
      type: unit.type,dots: selected.note.value.type===unit.type? selected.note.value.dots:0,
    })
    :undefined;
}

export function toggleFocusedTimelineNoteDot(project: ScoreProject,cursor: TimelineCursor) {
  if(getTupletContext(project.outline,cursor)) return undefined;
  const selected=cursor.focusedNoteId? ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff):undefined;
  return selected? setFocusedTimelineNoteValue(project,cursor,{
    ...selected.note.value,dots: selected.note.value.dots>0? 0:1,
  }):undefined;
}

/** Move a sustained note/chord without changing its explicit spelling or jumping its selection. */
export function moveFocusedTimelineNote(project: ScoreProject,cursor: TimelineCursor,direction: -1|1) {
  if(!cursor.focusedNoteId) return undefined;
  const selected=getSelectedTimelineNotes(project.outline,cursor);
  if(selected.some(entry => entry.tuplet)) return moveTupletSelection(project,cursor,new Set(selected.map(entry => entry.note.id)),direction);
  const result=NoteMovement.move(project,noteTarget(cursor),selected.map(entry => entry.note.id),direction*getTimelineInputSixteenths(cursor,project.outline));
  return result&&{ project: result.project,cursor: { ...cursor,positionSixteenths: result.position } };
}

export function setFocusedNoteStaccato(project: ScoreProject,cursor: TimelineCursor,staccato: StaccatoSettings|undefined): ScoreProject {
  const selected=cursor.focusedNoteId? ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff):undefined;
  return setFocusedNoteExpressions(project,cursor,{ staccato,accent: selected?.note.accent,fermata: selected?.note.fermata,arpeggio: selected?.note.arpeggio });
}
export function setFocusedNoteArpeggio(project: ScoreProject,cursor: TimelineCursor,arpeggio: ArpeggioSettings|undefined): ScoreProject {
  const selected=cursor.focusedNoteId? ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff):undefined;
  return setFocusedNoteExpressions(project,cursor,{ arpeggio,accent: selected?.note.accent,fermata: selected?.note.fermata,staccato: selected?.note.staccato });
}
/** Commit optional expressions together so replacing an exclusive effect is atomic. */
export function setFocusedNoteExpressions(project: ScoreProject,cursor: TimelineCursor,settings: Pick<PianoNote,'staccato'|'accent'|'fermata'|'arpeggio'>): ScoreProject {
  if(getSelectedTimelineNotes(project.outline,cursor).length!==1||!cursor.focusedNoteId||cursor.focusedGraceId) return project;
  return NoteExpressions.set(project,{ noteId: cursor.focusedNoteId,staff: cursor.staff },settings);
}

/** Transpose exactly the selected notes, keeping all chord intervals intact. */
export function transposeSelectedTimelineNotes(project: ScoreProject,cursor: TimelineCursor,direction: -1|1) {
  const selected=getSelectedTimelineNotes(project.outline,cursor);
  const next=NotePitches.transpose(project,cursor.staff,selected.map(entry => entry.note.id),direction);
  if(!next) return undefined;
  const focused=selected.find(entry => entry.note.id===cursor.focusedNoteId)!;
  return { project: next,cursor: { ...cursor,focusedPitchIndex: null,pitch: focused.note.pitches[0].midi+direction } };
}

export function moveTimelineCursorPitch(cursor: TimelineCursor,direction: -1|1,keySignature?: KeySignature,spellingKey: KeySignature={ fifths: 0 }): TimelineCursor {
  const pitch=PianoPitchRules.next(cursor.pitch,direction,keySignature);
  if(pitch===undefined) return cursor;
  return keySignature!==undefined ? { ...cursor,pitch,spellingDirection: undefined }
    : { ...cursor,pitch,spellingDirection: PitchSpelling.directionForMove(pitch,spellingKey,direction===1?'up':'down') };
}
export function moveFocusedTimelineNotePitch(project: ScoreProject,cursor: TimelineCursor,direction: -1|1,keySignature?: KeySignature,octave=false) {
  if(!cursor.focusedNoteId||cursor.focusedPitchIndex===null) return undefined;
  const result=NotePitches.move(project,{ noteId: cursor.focusedNoteId,staff: cursor.staff,pitchIndex: cursor.focusedPitchIndex },direction,keySignature,octave);
  return result&&{ project: result.project,cursor: { ...cursor,pitch: result.midi,focusedPitchIndex: result.pitchIndex } };
}

export function selectFocusedNotePitch(project: ScoreProject,cursor: TimelineCursor,direction: -1|1): TimelineCursor {
  if(cursor.focusedNoteId===null||cursor.focusedPitchIndex===null) return cursor;
  const index=cursor.focusedPitchIndex-direction;
  const pitch=ScoreTimeline.note(project.outline,cursor.focusedNoteId,cursor.staff)?.note.pitches[index];
  return pitch? { ...cursor,focusedPitchIndex: index,pitch: pitch.midi }:cursor;
}
export function addFocusedNotePitch(project: ScoreProject,cursor: TimelineCursor) {
  if(!cursor.focusedNoteId||cursor.focusedPitchIndex===null) return undefined;
  const result=NotePitches.add(project,{ noteId: cursor.focusedNoteId,staff: cursor.staff,pitchIndex: cursor.focusedPitchIndex });
  return result&&{ project: result.project,cursor: { ...cursor,pitch: result.midi,focusedPitchIndex: result.pitchIndex } };
}

/** Dissolve only groups emptied by this deletion, keeping neighboring rest spelling intact. */
export function deleteFocusedTimelineNote(project: ScoreProject,cursor: TimelineCursor,pitchOnly=false) {
  if(!cursor.focusedNoteId) return undefined;
  const result=NoteDeletion.remove(project,noteTarget(cursor),getSelectedTimelineNotes(project.outline,cursor).map(entry => entry.note.id),pitchOnly);
  if(!result) return undefined;
  return {
project: result.project,cursor: result.noteId? { ...cursor,focusedPitchIndex: result.pitchIndex!,pitch: result.pitch! }
      :{ ...cursor,positionSixteenths: result.position,focusedNoteId: null,focusedPitchIndex: null,selectionAnchorNoteId: null }
};
}

export const getTimelineLengthSixteenths=ScoreTimeline.length;
export const getMeasureAtPosition=ScoreTimeline.measureAt;
export const getLocatedTimelineNotes=ScoreTimeline.notes;
export const getAllTimelineNotes=ScoreTimeline.allNotes;
export const getLocatedTimelineNote=ScoreTimeline.note;
export const getTimelineTieChain=ScoreTimeline.tieChain;
export const getOutlinePositionSixteenths=ScoreTimeline.outlinePosition;
export const getOutlineBlockAtPosition=ScoreTimeline.blockAt;
