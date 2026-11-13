import type { Rational } from '../theory/musical-time.ts';
import type { KeySignature, TimeSignature, MeasureLength, NoteValue } from '../theory/notation-types.ts';
export type { KeySignature, TimeSignature, MeasureLength, NoteValue } from '../theory/notation-types.ts';

export type PianoFingering = 1 | 2 | 3 | 4 | 5;
export type DynamicLevel = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
export type SpellingDirection = 'up' | 'down';
export type PianoPitch = {
  midi: number;
  spellingDirection?: SpellingDirection;
  fingering?: PianoFingering;
  substitutionFingering?: PianoFingering;
};

/** Written grace notation, without metrical duration or recursively nested graces. */
export type PianoGraceNote = {
  id: string;
  pitches: PianoPitch[];
  value: NoteValue;
  slash: boolean;
};

export type StaccatoSettings = {
  type: 'normal' | 'staccatissimo';
  /** Key-hold duration as a fraction of this written note's performed duration. */
  lengthRatio: number;
};
export type AccentSettings = {
  /** Added to the current base MIDI velocity, capped at 127. */
  velocityOffset: number;
};
export type FermataSettings = {
  /** Hold multiplier; overlapping notes share the union span and the highest-priority member supplies this value. */
  lengthRatio: number;
};

export type ArpeggioSettings = {
  type: 'normal' | 'down';
  /** One sixteenth-note window, divided into as many slots as the chord has pitches. */
  spreadRatio: number;
  /** 0 aligns the first attack; 1 aligns the last attack to the written onset. */
  timing: number;
};

export type GracePerformanceSettings = {
  /** Total grace-note sequence window, measured as a fraction of a sixteenth note. */
  spreadRatio: number;
  /** 0 aligns the first grace attack; 1 aligns the last grace attack to the principal onset. */
  timing: number;
};

export type PianoNote = {
  /** In performance order, immediately before this written note. */
  beforeGraceNotes?: PianoGraceNote[];
  /** Performance settings for the grace-note group; its presence is derived from beforeGraceNotes. */
  gracePerformance?: GracePerformanceSettings;
  /** Independent of future arpeggio and ornament settings. */
  staccato?: StaccatoSettings;
  accent?: AccentSettings;
  fermata?: FermataSettings;
  arpeggio?: ArpeggioSettings;
  id: string;
  kind: 'note';
  value: NoteValue;
  /** Optional links retained for later explicit tie editing. */
  tieFrom?: string;
  tieTo?: string;
  /** Unique MIDI pitches, descending; all pitches share the written value. */
  pitches: PianoPitch[];
};

export type PianoRest = { id: string; kind: 'rest'; value: NoteValue };
/** Its elapsed time is the actual measure length, regardless of time signature. */
export type PianoMeasureRest = { id: string; kind: 'measure-rest' };
export type TupletRatio = { actual: number; normal: number };
export type PianoTuplet = {
  id: string;
  kind: 'tuplet';
  actual: number;
  normal: number;
  baseType: NoteValue['type'];
  /** Written values sum to actual base notes; rests are persisted, not inferred. */
  elements: (PianoNote | PianoRest)[];
};
export type PianoVoiceElement = PianoNote | PianoRest | PianoMeasureRest | PianoTuplet;
export type PianoVoice = { id: string; elements: PianoVoiceElement[] };
export type PianoStaff = { voices: PianoVoice[] };
export type PianoStaffName = 'upperStaff' | 'lowerStaff';

export type InitialValues = {
  keySignature: KeySignature;
  timeSignature: TimeSignature;
  /** Compound meters use a dotted quarter-note beat. */
  tempo: number;
};
export type InitialValuesBlock = { id: string; type: 'init'; data: InitialValues };
export type SectionBlock = { id: string; type: 'section'; data: { name: string } };
export type PedalEvent = {
  id: string;
  /** Local musical position, measured in sixteenth notes, independent of notes and voices. */
  offset: Rational;
  action: 'start' | 'change' | 'stop';
};
export type OttavaEvent = {
  id: string;
  /** Local musical position, measured in sixteenth notes, independent of notes and voices. */
  offset: Rational;
  staff: PianoStaffName;
  action: 'start' | 'stop';
};
export type MeasureBlock = {
  id: string;
  type: 'measure';
  data: { length: MeasureLength; upperStaff: PianoStaff; lowerStaff: PianoStaff; pedalEvents?: PedalEvent[]; ottavaEvents?: OttavaEvent[] };
};
export type KeyChangeBlock = { id: string; type: 'key-change'; data: { keySignature: KeySignature } };
export type OutlineBlock = InitialValuesBlock | SectionBlock | MeasureBlock | KeyChangeBlock;
export type TrillSettings = {
  auxiliary: 'diatonic' | 'half' | 'whole';
  start: 'main' | 'auxiliary';
  attackCount: number;
  /** One finger per attack, across the complete trill range. No substitutions. */
  fingerings?: PianoFingering[];
};
export type TrillSpan = {
  id: string;
  kind: 'trill';
  startNoteId: string;
  endNoteId: string;
  settings: TrillSettings;
};
export type ScoreProject = {
  slurs?: { id: string; startNoteId: string; endNoteId: string }[];
  clefChanges?: { noteId: string; clef: 'treble' | 'bass' }[];
  /** Global changes anchored to upper-staff voice-1 written notes. */
  tempoChanges?: { noteId: string; bpm: number }[];
  /** Global dynamic state changes anchored to upper-staff voice-1 written notes. */
  dynamicChanges?: { noteId: string; level: DynamicLevel; velocity: number }[];
  outline: [InitialValuesBlock, SectionBlock, ...OutlineBlock[]];
  trills?: TrillSpan[];
};
