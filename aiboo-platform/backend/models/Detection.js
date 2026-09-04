// backend/models/Detection.js
import mongoose from 'mongoose';

// Retention: detections auto-expire after RETENTION_DAYS (default 90) via a
// Mongo TTL index — prevents unbounded growth in long-running deployments.
const RETENTION_DAYS = parseInt(process.env.DETECTION_RETENTION_DAYS || '90', 10);

const detectionSchema = new mongoose.Schema(
  {
    cameraId: { type: mongoose.Schema.Types.Mixed, required: true }, // ObjectId for DB cameras, string for CV-only (webcam)
    cameraName: { type: String },
    location: { type: String },
    type: {
      type: String,
      // Superset: legacy backend types + every type the CV service emits
      // (COCO-mapped classes and custom detectors: fire, smoke, tamper, fall…).
      // The previous 12-value enum silently DROPPED critical CV detections.
      enum: [
        'person', 'vehicle', 'animal', 'bag', 'device', 'weapon', 'sports',
        'food', 'indoor', 'outdoor', 'electronics',
        'weapon_gun', 'weapon_knife', 'face_known', 'face_unknown', 'face_watchlist',
        'crowd', 'behavior_anomaly', 'breach',
        'fire', 'smoke', 'abandoned_object', 'fall', 'tamper', 'tripwire',
        'line_cross', 'traffic_anomaly', 'traffic', 'night_mode', 'zone_breach',
        'group', 'loitering', 'speed', 'face',
      ],
      required: true,
    },
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], default: 'low' },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    boundingBox: {
      x: Number, y: Number, width: Number, height: Number,
    },
    label: { type: String },
    snapshotUrl: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    acknowledged: { type: Boolean, default: false },
    escalated: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now, index: true },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

// TTL index — Mongo deletes docs when expiresAt passes.
detectionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
detectionSchema.index({ severity: 1, timestamp: -1 });
detectionSchema.index({ cameraId: 1, timestamp: -1 });

export default mongoose.model('Detection', detectionSchema);
