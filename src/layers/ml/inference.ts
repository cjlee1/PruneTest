// src/layers/ml/inference.ts
// ONNX inference session wrapper with session caching and fail-open behavior.

import * as ort from 'onnxruntime-node';

// Module-level session cache: modelPath → loaded session
const sessionCache = new Map<string, ort.InferenceSession>();

/**
 * Run inference on a pre-trained ONNX model.
 *
 * @param modelPath  Absolute path to the .onnx file
 * @param featureMatrix  Flat Float32Array of shape [numCandidates × 8]
 * @param numCandidates  Number of test candidates (rows in feature matrix)
 * @returns Float32Array of class-1 probabilities, one per candidate; all zeros on any error
 */
export async function runInference(
  modelPath: string,
  featureMatrix: Float32Array,
  numCandidates: number
): Promise<Float32Array> {
  try {
    // Lazy session creation with caching
    if (!sessionCache.has(modelPath)) {
      const session = await ort.InferenceSession.create(modelPath);
      sessionCache.set(modelPath, session);
    }
    const session = sessionCache.get(modelPath)!;

    // Build input tensor: [numCandidates, 8]
    // Convert to plain Array<number> to avoid realm-mismatch with Jest's VM
    // sandbox where Float32Array from test realm ≠ Float32Array in onnxruntime's realm.
    const inputData = Array.from(featureMatrix);
    const inputTensor = new ort.Tensor('float32', inputData, [numCandidates, 8]);

    // Run the session (fetch all outputs — we'll filter to float32 below)
    const results = await session.run({ float_input: inputTensor });

    // Extract probabilities: prefer known probability output names; fall back to the first
    // float32 output. Explicitly skip int64 outputs (class labels) which cannot be cast
    // to Float32Array in onnxruntime-node and would throw.
    const outputKey =
      'output_probability' in results
        ? 'output_probability'
        : 'probabilities' in results
        ? 'probabilities'
        : Object.keys(results).find((k) => results[k].type === 'float32') ??
          Object.keys(results)[0];

    const rawData = results[outputKey].data as Float32Array;

    // For each candidate, extract class-1 probability (index 1 of [p_class0, p_class1])
    const scores = new Float32Array(numCandidates);
    for (let i = 0; i < numCandidates; i++) {
      scores[i] = rawData[i * 2 + 1];
    }
    return scores;
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === 'ENOENT') {
      console.warn('[ML] model not found:', modelPath);
    } else {
      console.warn('[ML] inference error:', modelPath, error.message);
    }
    return new Float32Array(numCandidates);
  }
}
