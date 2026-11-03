import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import PreviewMusicXml from '../src/infra/musicxml/preview-musicxml.ts';
import ScorePreviewRenderer from '../src/infra/notation/score-preview-renderer.ts';
import {createScorePreview} from '../src/model/score-preview.ts';

test('MusicXML generation remains headless and isolated from notation and editor dependencies',()=>{
 assert.equal(createScorePreview,PreviewMusicXml.create);
 const folder=new URL('../src/infra/musicxml/',import.meta.url);
 for(const name of readdirSync(folder)){
  const source=readFileSync(new URL(name,folder),'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g))
   assert.ok(!/state|components|model|notation|opensheetmusicdisplay|svelte/.test(match[1]),`${name}: ${match[1]}`);
 }
 const ui=readFileSync(new URL('../src/components/ScorePreview.svelte',import.meta.url),'utf8');
 assert.ok(!/opensheetmusicdisplay|GraphicSheet|createElementNS|getBBox/.test(ui));
});
test('an already cancelled preview never loads OSMD or accesses the DOM host',async()=>{
 const controller=new AbortController();controller.abort();
 const host=new Proxy({}, {get(){throw new Error('cancelled rendering touched host');}});
 assert.equal(await ScorePreviewRenderer.render(host,{xml:'invalid',activeOffset:0,pedals:[],noteTargets:[]},controller.signal),undefined);
});
