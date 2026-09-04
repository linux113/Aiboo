#!/usr/bin/env python3
"""
tools/export_model.py — export the YOLOv8 weights for accelerated inference.

CPU images run the .pt fine; GPU nodes want ONNX (portable) or a TensorRT
engine (fastest, built per-GPU/architecture). The cv-service loads whatever
YOLO_MODEL_PATH points at — ultralytics accepts .pt/.onnx/.engine directly.

Usage (on a machine/CI job with the model + ultralytics installed):
    python tools/export_model.py --weights yolov8n.pt --format onnx  [--imgsz 640]
    python tools/export_model.py --weights yolov8n.pt --format engine --device 0

Then mount/copy the export next to app.py and run the service with:
    YOLO_MODEL_PATH=/app/models/yolov8n.engine YOLO_DEVICE=0

Notes
-----
- .engine files are GPU-architecture specific: build them on the same GPU
  class that will run inference (or bake per-arch images).
- TensorRT export requires `pip install tensorrt` (or the NVIDIA container
  toolkit image: nvcr.io/nvidia/pytorch) — see requirements-gpu.txt.
"""
import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Export YOLOv8 weights for deployment")
    parser.add_argument("--weights", default="yolov8n.pt", help="source .pt weights")
    parser.add_argument("--format", choices=["onnx", "engine"], default="onnx")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--half", action="store_true", help="FP16 (GPU only)")
    parser.add_argument("--device", default=None, help="cuda device for engine build, e.g. 0")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.weights)
    path = model.export(
        format=args.format,
        imgsz=args.imgsz,
        half=args.half or args.format == "engine",
        device=args.device,
    )
    print(f"exported: {path}")
    print("run cv-service with:")
    print(f"  YOLO_MODEL_PATH={path} YOLO_DEVICE={args.device or '0'}")


if __name__ == "__main__":
    main()
