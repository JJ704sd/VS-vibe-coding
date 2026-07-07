// inference.worker.ts — TF.js inference inside a Web Worker.
//
// Audit fix (2026-07-07 Track M, audit §1.10):
//   The dead `predictWithHeatmap` message branch and its `generateHeatmap`
//   helper have been removed. The branch was never called by the main
//   thread (the main thread had no caller for the { type: 'heatmap' }
//   response) and it produced an orphan heatmap message after the
//   prediction had already resolved the caller's promise.

import * as tf from '@tensorflow/tfjs';

let model: tf.LayersModel | null = null;

const loadModel = async (modelUrl: string) => {
  try {
    model = await tf.loadLayersModel(modelUrl);
    self.postMessage({ type: 'modelLoaded', success: true });
  } catch (error) {
    self.postMessage({ type: 'modelLoaded', success: false, error: String(error) });
  }
};

const runInference = async (signal: number[][]) => {
  if (!model) {
    self.postMessage({ type: 'error', error: 'Model not loaded' });
    return;
  }

  try {
    const tensor = tf.tensor3d([signal]);
    const prediction = model.predict(tensor) as tf.Tensor;
    const result = Array.from(await prediction.data());

    tensor.dispose();
    prediction.dispose();

    self.postMessage({ type: 'prediction', result });
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error) });
  }
};

self.onmessage = async (event: MessageEvent) => {
  const { type, data } = event.data;

  switch (type) {
    case 'loadModel':
      await loadModel(data.modelUrl);
      break;
    case 'predict':
      await runInference(data.signal);
      break;
    case 'dispose':
      model?.dispose();
      model = null;
      self.postMessage({ type: 'disposed' });
      break;
    default:
      self.postMessage({ type: 'error', error: `Unsupported message type: ${String(type)}` });
  }
};

export {};
