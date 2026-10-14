# Eye-tracking model used by /heatmap

`unisal-mit1003.onnx` is the UNISAL saliency model, fine-tuned on the MIT1003 eye-tracking dataset,
converted to ONNX with 8-bit / 16-bit weight storage (checked against the original: correlation ≥ 0.9997).

- Source: https://github.com/rdroste/unisal (`training_runs/pretrained_unisal/weights_ft_mit1003.pth`)
- Paper: R. Droste, J. Jiao, J. A. Noble, "Unified Image and Video Saliency Modeling", ECCV 2020
- License: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Modified: converted to ONNX and
  weights compressed; the network itself is unchanged.

It runs in the visitor's browser with ONNX Runtime Web (MIT license), loaded from jsDelivr.
