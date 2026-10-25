export type KeySignature = {
  /** Negative values count flats; positive values count sharps. */
  fifths: -7 | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
};

export type TimeSignature = {
  unit: number;
  cnt: number;
};

export type MeasureLength = {
  /** Note-value denominator used as the unit for this measure's actual length. */
  unit: number;
  /** Number of note-value units in this measure. */
  cnt: number;
};

export type NoteDuration = {
  /** Exact note value as a fraction of a whole note. */
  cnt: number;
  unit: number;
};

export type PianoPitch = {
  midi: number;
  fingering?: 1 | 2 | 3 | 4 | 5;
};

export type PianoNote = {
  id: string;
  /** Start offset within the measure, measured in sixteenth-note steps. */
  positionSixteenths: number;
  duration: NoteDuration;
  /** A chord is represented by multiple pitches with shared onset and duration. */
  pitches: PianoPitch[];
};

export type PianoVoice = {
  id: string;
  notes: PianoNote[];
};

export type PianoStaff = {
  voices: PianoVoice[];
};

export type InitialValues = {
  keySignature: KeySignature;
  timeSignature: TimeSignature;
  /** Beats per minute; compound meters use a dotted quarter-note beat. */
  tempo: number;
};

export type InitialValuesBlock = {
  id: string;
  type: 'init';
  data: InitialValues;
};

export type SectionBlock = {
  id: string;
  type: 'section';
  data: {
    name: string;
  };
};

export type MeasureBlock = {
  id: string;
  type: 'measure';
  data: {
    /** Distinct from the time signature: the actual length of this measure. */
    length: MeasureLength;
    upperStaff: PianoStaff;
    lowerStaff: PianoStaff;
  };
};

export function createMeasureData(length: MeasureLength): MeasureBlock['data'] {
  return {
    length: { ...length },
    upperStaff: { voices: [{ id: 'voice-0', notes: [] }] },
    lowerStaff: { voices: [{ id: 'voice-0', notes: [] }] },
  };
}

// Section markers and measure blocks share the same ordered array.
export type OutlineBlock = InitialValuesBlock | SectionBlock | MeasureBlock;

export type ScoreProject = {
  outline: [InitialValuesBlock, SectionBlock, ...OutlineBlock[]];
};

export function createProject(): ScoreProject {
  return {
    outline: [
      {
        id: 'initial-values',
        type: 'init',
        data: {
          keySignature: { fifths: 0 },
          timeSignature: { unit: 4, cnt: 4 },
          tempo: 100,
        },
      },
      {
        id: 'section-0',
        type: 'section',
        data: {
          name: 'section0',
        },
      },
    ],
  };
}
