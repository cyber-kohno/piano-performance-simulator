import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

test('rapid preview updates cancel XML preparation as well as rendering', async () => {
  const savedWindow = globalThis.window;
  const timers = new Map();
  let nextId = 0, prepared = 0, rendered = 0, finalOutline;
  globalThis.window = {
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  globalThis.__previewDebounce = {
    xml: { create(outline) { prepared++; finalOutline = outline; return { xml: 'test' }; } },
    renderer: { async render() { rendered++; } },
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
        api = { attach(node) { host = node; }, update(next) { outline = next; } };
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
    view.update([{ id: 'cancel-on-destroy' }]);
    await settle();
    dispose(); dispose = undefined;
    assert.equal(timers.size, 0);
    assert.equal(prepared, 1);
  } finally {
    dispose?.();
    globalThis.window = savedWindow;
    delete globalThis.__previewDebounce;
  }
});
