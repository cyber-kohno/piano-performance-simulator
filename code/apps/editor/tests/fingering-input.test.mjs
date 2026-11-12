import assert from 'node:assert/strict';
import { test } from 'node:test';
import ScoreFingerings from '../src/domain/score/score-fingerings.ts';
import FingeringInput from '../src/state/fingering-input.ts';
import NotePitches from '../src/domain/score/note-pitches.ts';
import Factory from '../src/domain/score/score-project.ts';
import Measure from '../src/domain/score/score-measure.ts';
import Timeline from '../src/domain/score/score-timeline.ts';

const grace = (id, midi, fingering) => ({id, value:{type:'eighth',dots:0}, slash:true,
  pitches:[{midi,...(fingering === undefined ? {} : {fingering})}]});
const chord = () => ({id:'chord',kind:'note',value:{type:'whole',dots:0},
  pitches:[{midi:67,fingering:5},{midi:64,fingering:1,substitutionFingering:2},{midi:60,fingering:3}]});

test('chord input excludes itself, reserves only sibling initial fingers, and checks both entered fingers',()=>{
  const rules=ScoreFingerings.rules(chord(),0);
  assert.deepEqual([...rules.usedFingerings],[1,3]);
  assert.deepEqual(FingeringInput.parse('5',rules),{fingering:5});
  assert.deepEqual(FingeringInput.parse('2-4',rules),{fingering:2,substitutionFingering:4});
  for(const value of ['1','3','1-4','4-1','3-2','2-3','2-2','','0','6','1-2-3']) {
    assert.equal(FingeringInput.parse(value,rules),undefined,value);
  }
});

test('parent and all attached graces reserve fingers mutually, and grace input rejects substitution',()=>{
  const note={id:'parent',kind:'note',value:{type:'quarter',dots:0},
    pitches:[{midi:60,fingering:1,substitutionFingering:2}],
    beforeGraceNotes:[grace('a',59,3),grace('b',58,4),grace('c',57)]};
  const rules=ScoreFingerings.rules(note,0,'a');
  assert.deepEqual([...rules.usedFingerings],[1,4]);
  assert.deepEqual(FingeringInput.parse('3',rules),{fingering:3});
  assert.deepEqual(FingeringInput.parse('2',rules),{fingering:2});
  for(const value of ['1','4','2-5','3-2']) assert.equal(FingeringInput.parse(value,rules),undefined,value);
  const parentRules=ScoreFingerings.rules(note,0);
  assert.equal(FingeringInput.parse('3',parentRules),undefined);
  assert.equal(FingeringInput.parse('4',parentRules),undefined);
  assert.deepEqual(FingeringInput.parse('1-2',parentRules),{fingering:1,substitutionFingering:2});
  // The rules captured on opening remain a snapshot until the input is reopened.
  note.beforeGraceNotes[1].pitches[0].fingering=5;
  assert.equal(FingeringInput.parse('4',rules),undefined);
  assert.deepEqual(FingeringInput.parse('4',ScoreFingerings.rules(note,0,'a')),{fingering:4});
});

test('domain refuses sibling collisions atomically and allows reuse of a sibling substitution finger',()=>{
  const project=Factory.create();
  const data=Measure.create({unit:4,cnt:4});
  data.upperStaff.voices[0].elements=[chord()];
  project.outline.push({id:'m',type:'measure',data});
  const before=structuredClone(project), target={noteId:'chord',staff:'upperStaff',pitchIndex:0};
  assert.equal(NotePitches.setFingering(project,target,1),project);
  assert.equal(NotePitches.setFingering(project,target,4,3),project);
  const updated=NotePitches.setFingering(project,target,2,4);
  assert.deepEqual(Timeline.note(updated.outline,'chord').note.pitches[0],{midi:67,fingering:2,substitutionFingering:4});
  assert.deepEqual(project,before);
  const cleared=NotePitches.setFingering(updated,target,null);
  assert.deepEqual(Timeline.note(cleared.outline,'chord').note.pitches[0],{midi:67});
});
