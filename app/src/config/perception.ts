import type {
  Delegate,
  PerceptionOptions,
  PerceptionSource,
  PoseModel,
} from '../perception/protocol';

const MODELS: readonly PoseModel[] = ['lite', 'full', 'heavy'];
const DELEGATES: readonly Delegate[] = ['GPU', 'CPU'];
const SOURCES: readonly PerceptionSource[] = ['server', 'mediapipe'];

export const perceptionDefaults: PerceptionOptions = {
  source: 'server',
  serverUrl: 'ws://127.0.0.1:8765',
  model: 'heavy',
  delegate: 'GPU',
  numPoses: 3,
  // Speeds are in shoulder widths per second (see perception.worker.ts).
  filter: { minCutoff: 0.8, beta: 3, dCutoff: 1 },
};

/**
 * Defaults, overridable from the URL for benchmarking and tuning:
 * `?perception=mediapipe&model=full&delegate=CPU&numPoses=1&minCutoff=0.5&beta=5&dCutoff=1`,
 * `?server=ws://127.0.0.1:8765` or `?filter=off`.
 */
export function perceptionOptionsFromUrl(search: string): PerceptionOptions {
  const params = new URLSearchParams(search);
  const source = params.get('perception');
  const server = params.get('server');
  const model = params.get('model');
  const delegate = params.get('delegate');
  const numPoses = Number(params.get('numPoses'));
  const filter = perceptionDefaults.filter;
  const positive = (name: string, fallback: number) => {
    const value = Number(params.get(name) ?? NaN);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    source: SOURCES.find((s) => s === source) ?? perceptionDefaults.source,
    serverUrl: server !== null && /^wss?:\/\//.test(server) ? server : perceptionDefaults.serverUrl,
    model: MODELS.find((m) => m === model) ?? perceptionDefaults.model,
    delegate: DELEGATES.find((d) => d === delegate) ?? perceptionDefaults.delegate,
    numPoses: Number.isInteger(numPoses) && numPoses >= 1 ? numPoses : perceptionDefaults.numPoses,
    filter:
      params.get('filter') === 'off' || filter === null
        ? null
        : {
            minCutoff: positive('minCutoff', filter.minCutoff),
            beta: positive('beta', filter.beta),
            dCutoff: positive('dCutoff', filter.dCutoff),
          },
  };
}
