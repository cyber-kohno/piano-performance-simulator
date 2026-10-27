import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

test('hold lifecycle handles both Shift keys, focus loss, missed releases and disposal', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let dispose;
  // Use the real Svelte reactive compiler/runtime; only mounting and DOM events
  // are provided by the fixture so the lifecycle can run without a browser.
  globalThis.__mountKeyHoldTest = callback => { dispose = callback(); };
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.hidden = false;
  try {
    const source = readFileSync(new URL('../src/state/key-hold.svelte.ts', import.meta.url), 'utf8');
    const js = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText;
    const compiled = compileModule(js, { filename: 'key-hold.svelte.js', generate: 'client' }).js.code
      .replace("import { onMount } from 'svelte';", 'const onMount = globalThis.__mountKeyHoldTest;')
      .replace("'svelte/internal/client'", JSON.stringify(import.meta.resolve('svelte/internal/client')));
    const { createKeyHold } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
    const hold = createKeyHold();
    const key = (type, code, shiftKey) => {
      const event = new Event(type);
      Object.assign(event, { code, shiftKey });
      window.dispatchEvent(event);
    };
    key('keydown', 'KeyE', false);
    assert.equal(hold.noteNavigation, true);
    assert.equal(hold.pitchSelection, true);
    key('keyup', 'KeyE', false);
    assert.equal(hold.noteNavigation, false);
    assert.equal(hold.pitchSelection, false);
    key('keydown', 'KeyF', false);
    assert.equal(hold.noteValueEditing, true);
    key('keyup', 'KeyF', false);
    assert.equal(hold.noteValueEditing, false);
    key('keydown', 'KeyD', false);
    assert.equal(hold.notePositionEditing, true);
    key('keyup', 'KeyD', false);
    assert.equal(hold.notePositionEditing, false);
    key('keydown', 'ShiftLeft', true);
    assert.equal(hold.rangeSelection, true);
    assert.equal(hold.pitchSelection, false);
    key('keydown', 'KeyC', true);
    assert.equal(hold.diatonicMovement, true);
    key('keyup', 'KeyC', true);
    assert.equal(hold.diatonicMovement, false);
    key('keydown', 'ShiftLeft', true); // repeats must not require extra releases
    key('keydown', 'ShiftRight', true);
    key('keyup', 'ShiftLeft', true);
    assert.equal(hold.rangeSelection, true);
    key('keyup', 'ShiftRight', false);
    assert.equal(hold.rangeSelection, false);
    key('keydown', 'ShiftLeft', true);
    key('keydown', 'KeyC', true);
    key('keydown', 'KeyE', true);
    key('keydown', 'KeyF', true);
    key('keydown', 'KeyD', true);
    window.dispatchEvent(new Event('blur'));
    assert.equal(hold.rangeSelection, false);
    assert.equal(hold.pitchSelection, false);
    assert.equal(hold.diatonicMovement, false);
    assert.equal(hold.noteNavigation, false);
    assert.equal(hold.noteValueEditing, false);
    assert.equal(hold.notePositionEditing, false);
    key('keydown', 'ShiftLeft', true);
    key('keydown', 'KeyC', true);
    key('keydown', 'KeyE', true);
    key('keydown', 'KeyF', true);
    key('keydown', 'KeyD', true);
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(hold.rangeSelection, false);
    assert.equal(hold.pitchSelection, false);
    assert.equal(hold.diatonicMovement, false);
    assert.equal(hold.noteNavigation, false);
    assert.equal(hold.noteValueEditing, false);
    assert.equal(hold.notePositionEditing, false);
    key('keydown', 'ShiftLeft', true);
    key('keydown', 'KeyA', false);
    assert.equal(hold.rangeSelection, false);
    assert.equal(hold.pitchSelection, false);
    key('keydown', 'ShiftLeft', true);
    dispose();
    assert.equal(hold.rangeSelection, false);
    assert.equal(hold.pitchSelection, false);
    key('keydown', 'ShiftLeft', true);
    assert.equal(hold.pitchSelection, false);
  } finally {
    dispose?.();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    delete globalThis.__mountKeyHoldTest;
  }
});
