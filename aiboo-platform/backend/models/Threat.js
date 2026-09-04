// src/models/Threat.js
import mongoose from 'mongoose';

const threatSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['critical', 'high', 'medium', 'low'], required: true },
    title: { type: String, required: true },
    description: { type: String },
    asset: { type: String },
    source: {
      type: String,
      // 'agent'/'cv-service' added so agent correlated alerts can materialise
      // as Threat documents (previously rejected by the 3-value enum).
      enum: ['firewall', 'camera', 'va-scan', 'agent', 'cv-service', 'siem', 'manual'],
      required: true,
    },
    status: { type: String, enum: ['open', 'investigating', 'resolved'], default: 'open' },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

threatSchema.index({ status: 1, severity: 1, timestamp: -1 });

export default mongoose.model('Threat', threatSchema);