// Run from the repository root:
// node --experimental-transform-types code/apps/editor/scripts/benchmark-playback.mjs
import Factory from '../src/domain/score/score-project.ts';
import Measure from '../src/domain/score/score-measure.ts';
import Plan from '../src/domain/performance/score-playback-plan.ts';

export function denseScore(count) {
  const project = Factory.create();
  for (let i = 0; i < count; i++) {
    const data = Measure.create({ cnt: 4, unit: 4 });
    for (const staff of ['upperStaff', 'lowerStaff']) {
      data[staff].voices[0].elements = Array.from({ length: 16 }, (_, index) => ({
        id: `${staff}-${i}-${index}`, kind: 'note', value: { type: '16th', dots: 0 },
        pitches: [{ midi: staff === 'upperStaff' ? 60 : 48 }],
      }));
    }
    project.outline.push({ id: `m-${i}`, type: 'measure', data });
  }
  return project;
}

function medianTime(run) {
  const samples = Array.from({ length: 3 }, () => {
    const start = performance.now(); run(); return performance.now() - start;
  });
  return Number(samples.sort((a, b) => a - b)[1].toFixed(2));
}

Plan.create(denseScore(2), 0);
for (const measures of [20, 50, 100]) {
  const project = denseScore(measures), prepared = Plan.prepare(project);
  console.log(JSON.stringify({ measures, notes: measures * 32,
    prepareAndPlanMs: medianTime(() => Plan.create(project, 0)),
    preparedPlanMs: medianTime(() => prepared.create(0)),
    interiorStartMs: medianTime(() => prepared.create(measures * 8)),
  }));
}
