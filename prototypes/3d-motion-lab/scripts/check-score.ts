import score from '../src/data/tied-score.json';
import { normalizePerformance, inputLength } from '../src/score-input';
import { evaluate, heldPlansFor, preparePerformance, validate } from '../src/motion';

const started=performance.now();
const input=normalizePerformance(score),normalized=performance.now();
const notes=validate(input.notes);preparePerformance(notes);
const prepared=performance.now(),duration=inputLength(input);
for(let i=0;i<1000;i++)evaluate(notes,duration*(i%2?1-i/1000:i/1000),'scale','connected','smooth',true);
const completed=performance.now(),plans=heldPlansFor(notes);
console.log(JSON.stringify({sourceNotes:input.sources.length,performanceNotes:notes.length,tieChains:input.tieChains,
  rests:input.rests.length,tempoChanges:input.tempos.length,holdingPassages:{left:plans.left.length,right:plans.right.length},
  durationSeconds:duration,normalizationMs:normalized-started,planningMs:prepared-normalized,
  evaluate1000Ms:completed-prepared},null,2));
