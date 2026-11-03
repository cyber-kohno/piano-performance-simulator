import assert from 'node:assert/strict';
import {test} from 'node:test';
import NoteSettings from '../src/state/note-settings.ts';
import NoteEditor from '../src/action/editor/note-editor.ts';
import ScoreProjectFactory from '../src/domain/score/score-project.ts';
import ScoreMeasure from '../src/domain/score/score-measure.ts';
import ScoreTimeline from '../src/domain/score/score-timeline.ts';
import {createTimelineCursor} from '../src/state/timeline-cursor.ts';
function fixture(){const p=ScoreProjectFactory.create();p.outline.push({id:'m',type:'measure',data:ScoreMeasure.create({unit:4,cnt:4})});return NoteEditor.add(p,createTimelineCursor());}
const key=(project,editor,key,extra={})=>NoteSettings.control(project,editor,{key,repeat:false,shiftKey:false,isComposing:false,altKey:false,ctrlKey:false,metaKey:false,...extra});
test('note settings isolate both drafts, discard on Escape and commit together only on Shift Enter',()=>{
 const {project,cursor}=fixture(),before=structuredClone(project);
 let editor=NoteSettings.open(project,cursor);assert.equal(editor.target.measureNumber,1);
 editor=key(project,editor,'Enter').editor;
 assert.deepEqual(editor.expression.draft.staccato,{type:'normal',lengthRatio:0.5});
 assert.deepEqual(project,before);assert.deepEqual(key(project,editor,'Escape'),{editor:null});
 editor=key(project,editor,'Tab').editor;assert.equal(editor.tab,'changes');
 editor=key(project,editor,'Enter').editor;assert.equal(editor.changes.tempo.bpm,100);
 editor=key(project,editor,'ArrowRight').editor;
 const result=key(project,editor,'Enter',{shiftKey:true});assert.equal(result.editor,null);assert.equal(result.commit.tempo.bpm,101);
 const saved=NoteEditor.configure(project,cursor,result.commit),reopened=NoteSettings.open(saved,cursor);
 assert.equal(reopened.changes.tempo.bpm,101);assert.equal(reopened.expression.draft.staccato.lengthRatio,0.5);assert.deepEqual(project,before);
});
test('settings route Tab once, allow arrow repeat and ignore composition and modified input',()=>{
 const {project,cursor}=fixture(),editor=NoteSettings.open(project,cursor);
 for(const extra of [{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true}])assert.equal(key(project,editor,'Tab',extra).editor,editor);
 const opened=key(project,editor,'Enter').editor;
 assert.equal(key(project,opened,'Enter',{shiftKey:true,repeat:true}).commit,undefined);
 assert.equal(key(project,opened,'ArrowRight',{repeat:true}).editor.expression.draft.staccato.type,'staccatissimo');
 assert.equal(key(project,opened,'ArrowRight',{shiftKey:true}).editor,opened);
});
test('invalid drafts and missing note targets stay open and never emit a commit',()=>{
 const {project,cursor}=fixture();let editor=NoteSettings.open(project,cursor);
 editor={...editor,expression:{...editor.expression,draft:{staccato:{type:'normal',lengthRatio:3}}}};
 const invalid=key(project,editor,'Enter',{shiftKey:true});assert.equal(invalid.commit,undefined);assert.ok(invalid.editor.expression.error);
 const missing=structuredClone(project);missing.outline.pop();
 const absent=key(missing,NoteSettings.open(project,cursor),'Enter',{shiftKey:true});assert.equal(absent.commit,undefined);assert.match(absent.editor.expression.error,/no longer available/);
});
test('modal eligibility and available change fields follow the selected staff and local voice',()=>{
 const {project,cursor}=fixture();assert.equal(NoteSettings.open(project,{...cursor,focusedNoteId:null}),undefined);
 const grace=NoteEditor.addGrace(project,cursor);assert.equal(NoteSettings.open(grace.project,grace.cursor),undefined);
 const lower=NoteEditor.add(project,{...createTimelineCursor('lowerStaff'),pitch:48});
 const result=key(lower.project,NoteSettings.open(lower.project,lower.cursor),'Enter',{shiftKey:true});
 assert.equal(Object.hasOwn(result.commit,'tempo'),false);assert.equal(Object.hasOwn(result.commit,'clef'),true);
 assert.equal(ScoreTimeline.note(project.outline,cursor.focusedNoteId).note.staccato,undefined);
});
