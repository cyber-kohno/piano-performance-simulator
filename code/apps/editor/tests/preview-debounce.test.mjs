import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

test('rapid preview updates cancel XML preparation as well as rendering', async () => {
  const savedWindow = globalThis.window;
  const frames = new Map(), painted = [];
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let frameId = 0, playingIds = [];
  globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const timers = new Map();
  let nextId = 0, prepared = 0, rendered = 0, finalOutline;
  globalThis.window = {
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.__previewDebounce = {
    xml: { create(outline) { prepared++; finalOutline = outline; return { xml: 'test' }; } },
    renderer: { async render() { rendered++; return (ids, color) => painted.push({ ids: [...ids], color }); } },
  };
  let dispose;
  try {
    const source = readFileSync(new URL('../src/components/ScorePreview.svelte', import.meta.url), 'utf8')
      .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const js = ts.transpileModule(source.replace('$props()', '$state(options)'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
    const ast = ts.createSourceFile('preview.js', js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
      .map(statement => statement.getText(ast)).join('\n');
    const harness = `export function fixture(options) {
      let api;
      const dispose = $effect.root(() => {
        const PreviewMusicXml = globalThis.__previewDebounce.xml;
        const ScorePreviewRenderer = globalThis.__previewDebounce.renderer;
        ${body}
        api = { attach(node) { host = node; }, update(next) { outline = next; }, start(read) { getPlayingNoteIds = read; playbackActive = true; }, stop() { playbackActive = false; } };
      });
      return { ...api, dispose };
    }`;
    const compiled = compileModule(harness, { filename: 'preview.svelte.js', generate: 'client' }).js.code
      .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')));
    const { fixture } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
    const view = fixture({ outline: [{ id: 'initial' }], activeIndex: 0 });
    dispose = view.dispose;
    class Host { replaceChildren() {} }
    view.attach(new Host());
    const settle = () => new Promise(resolve => setImmediate(resolve));
    await settle();
    assert.equal(prepared, 0);
    assert.equal(timers.size, 1);
    for (let i = 0; i < 5; i++) {
      view.update([{ id: `revision-${i}` }]);
      await settle();
      assert.equal(timers.size, 1);
      assert.equal(prepared, 0);
    }
    const callback = [...timers.values()][0]; timers.clear();
    await callback();
    assert.equal(prepared, 1);
    assert.equal(rendered, 1);
    assert.equal(finalOutline[0].id, 'revision-4');
    await settle();
    view.start(() => playingIds); await settle();
    assert.equal(frames.size, 1);
    playingIds = ['sounding'];
    const frame = [...frames.values()][0]; frames.clear(); frame();
    assert.deepEqual(painted.at(-1), { ids: ['sounding'], color: '#e65100' });
    assert.equal(prepared, 1); assert.equal(rendered, 1); assert.equal(timers.size, 0);
    view.stop(); await settle();
    assert.equal(frames.size, 0); assert.deepEqual(painted.at(-1).ids, []);
    view.start(() => playingIds); await settle();
    assert.equal(frames.size, 1);
    view.update([{ id: 'cancel-on-destroy' }]);
    await settle();
    dispose(); dispose = undefined;
    assert.equal(timers.size, 0);
    assert.equal(prepared, 1);
  } finally {
    dispose?.();
    globalThis.window = savedWindow;
    if (oldRequest === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldRequest;
    if (oldCancel === undefined) delete globalThis.cancelAnimationFrame; else globalThis.cancelAnimationFrame = oldCancel;
    delete globalThis.__previewDebounce;
  }
});
