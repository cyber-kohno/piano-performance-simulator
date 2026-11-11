import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import TimelineView from '../src/state/timeline-view.ts';
import { createProject, createMeasureData } from '../src/model/project.ts';
import { createTimelineCursor } from '../src/state/timeline-cursor.ts';

function projectWithBars(lengths) {
  const project = createProject();
  lengths.forEach((length, index) => project.outline.push({
    id: `m${index}`, type: 'measure', data: createMeasureData(length),
  }));
  return project;
}
const regularBars = count => Array.from({ length: count }, () => ({ cnt: 4, unit: 4 }));

test('focus window contains neighboring bars and jumps directly to a distant section', () => {
  const measures = TimelineView.layout(projectWithBars(regularBars(100)).outline, 480);
  const first = TimelineView.focusedMeasureWindow(measures, 0, 960);
  assert.deepEqual(first.indices, [0, 1, 2]);
  const distant = TimelineView.focusedMeasureWindow(measures, 40, 960);
  assert.deepEqual(distant.indices, [38, 39, 40, 41, 42]);
  assert.equal(distant.start, measures[38].start);
  assert.equal(distant.end, measures[42].start + measures[42].width);
  assert.ok(!distant.indices.includes(20));
  assert.deepEqual(TimelineView.focusedMeasureWindow(measures, 99, 960).indices, [97, 98, 99]);
  assert.deepEqual(TimelineView.focusedMeasureWindow([], 0, 960), { indices: [], start: 0, end: 0 });
});

test('short bars, wide screens and a long focused bar cover every final viewport', () => {
  const lengths = Array.from({ length: 120 }, (_, i) => ({ cnt: i === 60 ? 16 : 1, unit: i === 60 ? 4 : 16 }));
  const measures = TimelineView.layout(projectWithBars(lengths).outline, 480);
  for (const width of [480, 960, 2500]) {
    for (const index of [0, 30, 60, 119]) {
      const window = TimelineView.focusedMeasureWindow(measures, index, width);
      const focus = measures[index];
      const scoreEnd = measures.at(-1).start + measures.at(-1).width;
      for (const position of [focus.start, focus.start + focus.width / 2, focus.start + focus.width]) {
        const left = Math.max(0, Math.min(scoreEnd - width / 2, position - width / 2));
        assert.ok(window.start <= left);
        assert.ok(window.end >= Math.min(scoreEnd, left + width));
      }
    }
  }
  assert.ok(TimelineView.focusedMeasureWindow(measures, 30, 2500).indices.length > 5);
});

test('layout edits and resizing update the focused window without stale measure indices', () => {
  const project = projectWithBars(regularBars(10));
  const focusId = 'm5';
  project.outline.splice(3, 0, { id: 'inserted', type: 'measure', data: createMeasureData({ cnt: 1, unit: 16 }) });
  project.outline.splice(2, 1);
  project.outline.find(block => block.id === focusId).data.length = { cnt: 1, unit: 16 };
  const measures = TimelineView.layout(project.outline, 480);
  const index = measures.findIndex(measure => measure.id === focusId);
  const small = TimelineView.focusedMeasureWindow(measures, index, 480);
  const wide = TimelineView.focusedMeasureWindow(measures, index, 3000);
  assert.ok(small.indices.includes(index));
  assert.ok(wide.start <= small.start && wide.end >= small.end);
  assert.ok(wide.indices.every(i => measures[i]));
});

async function componentFixture() {
  // Exercise the actual component's reactive script and scroll handler with
  // Svelte's compiler/runtime. Only DOM mounting/effects are omitted.
  const componentUrl = new URL('../src/components/TimelinePanel.svelte', import.meta.url);
  const source = readFileSync(componentUrl, 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const js = ts.transpileModule(source.replace('$props()', '$state(options)'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const ast = ts.createSourceFile('fixture.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = [], body = [];
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) { body.push(statement.getText(ast)); continue; }
    const path = statement.moduleSpecifier.text;
    if (path === 'svelte') continue;
    const resolved = path.startsWith('.') ? new URL(/\.[a-z]+$/i.test(path) ? path : `${path}.ts`, componentUrl).href : path;
    imports.push(statement.getText(ast).replace(statement.moduleSpecifier.getText(ast), JSON.stringify(resolved)));
  }
  const harness = `${imports.join('\n')}
    export function createFixture(options) {
      const onDestroy = () => {}, ignoreEffect = () => {};
      ${body.join('\n').replace(/\$effect\(/g, 'ignoreEffect(')}
      return {
        attach(roll) { pianoRollViewport = roll; syncTimelineScroll(); },
        scroll: syncTimelineScroll,
        focus(position) { timelineCursor = { ...timelineCursor, positionSixteenths: position }; },
        outlineFocus(blockId) { playbackPosition = null; mode = 'outline'; cursor = { blockId }; },
        play(position) { playbackPosition = position; },
        get window() { return renderWindow; },
        get data() { return [visibleMeasures, visibleTiePaths, visibleSlurPaths, visiblePedalEvents,
          visiblePedalSpans, visibleOttavaEvents, visibleOttavaSpans]; }
      };
    }`;
  const compiled = compileModule(harness, { filename: 'timeline-fixture.svelte.js', generate: 'client' }).js.code
    .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')));
  return (await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))).createFixture;
}

test('horizontal animation reuses display data; focus, playback and vertical scrolling still update it', async () => {
  const createFixture = await componentFixture();
  const project = projectWithBars(regularBars(100));
  project.outline.find(block => block.id === 'm50').data.upperStaff.voices[0].elements = [
    { id: 'high-note', kind: 'note', value: { type: 'quarter', dots: 0 }, pitches: [{ midi: 108 }] },
  ];
  project.outline.splice(22, 0, { id: 'section20', type: 'section', data: { name: 'Middle' } });
  project.outline.push({ id: 'tail', type: 'section', data: { name: 'End' } });
  const view = createFixture({ outline: project.outline, cursor: { blockId: 'm0' },
    timelineCursor: createTimelineCursor(), mode: 'timeline', pedalCursor: {}, ottavaCursor: {} });
  // Like a DOM element, this must not be converted into a deep state proxy.
  class Viewport { scrollLeft = 0; scrollTop = 0; clientWidth = 960; clientHeight = 600; }
  const roll = new Viewport();
  view.attach(roll);
  const initialWindow = view.window, initialData = view.data;
  for (let frame = 1; frame <= 15; frame++) {
    roll.scrollLeft = frame * 80;
    view.scroll();
    assert.equal(view.window, initialWindow);
    view.data.forEach((data, i) => assert.equal(data, initialData[i]));
  }
  view.focus(16 * 40);
  const jumped = view.window;
  assert.ok(jumped.indices.includes(40));
  view.focus(16 * 40 + 4);
  assert.equal(view.window, jumped);
  view.play(16 * 50);
  const playing = view.window;
  assert.ok(playing.indices.includes(50));
  view.play(16 * 50 + 8);
  assert.equal(view.window, playing);
  const beforeVertical = view.data[0];
  assert.equal(beforeVertical.find(item => item.measure.id === 'm50').notes.length, 1);
  assert.equal(beforeVertical.find(item => item.measure.id === 'm50').visibleNotes.length, 1);
  roll.scrollTop = 240;
  view.scroll();
  assert.equal(view.window, playing);
  assert.notEqual(view.data[0], beforeVertical);
  const afterVertical = view.data[0].find(item => item.measure.id === 'm50');
  assert.equal(afterVertical.visibleNotes.length, 0);
  assert.equal(afterVertical.notes, beforeVertical.find(item => item.measure.id === 'm50').notes);
  assert.equal(afterVertical.notes[0].note.id, 'high-note');
  roll.clientWidth = 3000;
  view.scroll();
  assert.notEqual(view.window, playing);
  view.outlineFocus('section20');
  assert.ok(view.window.indices.includes(20));
  view.outlineFocus('tail');
  assert.equal(view.window.indices.at(-1), 99);
  view.outlineFocus(project.outline[0].id);
  assert.equal(view.window.indices[0], 0);
});
