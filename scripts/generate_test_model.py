#!/usr/bin/env python3
"""
Generate a minimal synthetic ONNX model for S01 contract testing.
Replace with a real pretrained model in S02.

Generated test model for S01 contract testing. Replace with real pretrained model in S02.

Usage:
    pip install scikit-learn skl2onnx numpy onnx
    python3 scripts/generate_test_model.py
"""

import os
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

try:
    import onnx
    from onnx import helper as onnx_helper
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    print('Warning: onnx package not available; label output will remain in model')

# Reproducible synthetic data: 20 samples, 8 features, binary labels
rng = np.random.RandomState(42)
X = rng.rand(20, 8).astype(np.float32)
y = (X[:, 0] + X[:, 2] > 1.0).astype(np.int64)

# Train a minimal GradientBoostingClassifier
clf = GradientBoostingClassifier(n_estimators=5, max_depth=2, random_state=42)
clf.fit(X, y)

# Export to ONNX with zipmap=False so outputs are plain float arrays
initial_type = [('float_input', FloatTensorType([None, 8]))]
options = {id(clf): {'zipmap': False}}
model_proto = to_onnx(clf, X[:1], options=options, target_opset=17, initial_types=initial_type)

# Prune the int64 label output so onnxruntime-node only sees the float32 probabilities.
# This avoids BigInt64Array realm-mismatch errors in Jest test environments.
if HAS_ONNX:
    # Find the probabilities output (float32) and keep only that
    prob_output = None
    for output in model_proto.graph.output:
        type_proto = output.type
        if type_proto.HasField('tensor_type'):
            elem_type = type_proto.tensor_type.elem_type
            # float32 = 1, int64 = 7
            if elem_type == 1:
                prob_output = output
                break

    if prob_output is not None:
        # Clear existing outputs and add only the probability output
        del model_proto.graph.output[:]
        model_proto.graph.output.append(prob_output)
        # Rename to 'probabilities' for clarity if needed
        print(f'Pruned to single output: {prob_output.name}')
    else:
        print('Warning: could not find float32 output to prune')

# Save to models/gbdt.onnx (relative to repo root)
output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models')
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, 'gbdt.onnx')

with open(output_path, 'wb') as f:
    f.write(model_proto.SerializeToString())

print(f'Wrote {os.path.getsize(output_path)} bytes to {output_path}')
print(f'Output names: {[o.name for o in model_proto.graph.output]}')
