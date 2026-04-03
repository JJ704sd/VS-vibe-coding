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

const generateHeatmap = (signal: number[][]): number[] => {
  const lead = signal[0] || [];
  const max = Math.max(...lead.map((value) => Math.abs(value)), 1);
  return lead.map((value) => Math.abs(value) / max);
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
    case 'predictWithHeatmap':
      await runInference(data.signal);
      self.postMessage({ type: 'heatmap', heatmap: generateHeatmap(data.signal) });
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
