import type { Delegate, PerceptionOptions, PoseModel } from '../perception/protocol';

const MODELS: readonly PoseModel[] = ['lite', 'full', 'heavy'];
const DELEGATES: readonly Delegate[] = ['GPU', 'CPU'];

export const perceptionDefaults: PerceptionOptions = {
  model: 'full',
  delegate: 'GPU',
  numPoses: 3,
};

/** Defaults, overridable from the URL for benchmarking: `?model=heavy&delegate=CPU&numPoses=1`. */
export function perceptionOptionsFromUrl(search: string): PerceptionOptions {
  const params = new URLSearchParams(search);
  const model = params.get('model');
  const delegate = params.get('delegate');
  const numPoses = Number(params.get('numPoses'));
  return {
    model: MODELS.find((m) => m === model) ?? perceptionDefaults.model,
    delegate: DELEGATES.find((d) => d === delegate) ?? perceptionDefaults.delegate,
    numPoses: Number.isInteger(numPoses) && numPoses >= 1 ? numPoses : perceptionDefaults.numPoses,
  };
}
