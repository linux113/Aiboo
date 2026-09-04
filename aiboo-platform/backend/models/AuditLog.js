// backend/models/AuditLog.js — immutable who-did-what trail (SOC 2 evidence).
import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema(
  {
    actor: {
      id: { type: mongoose.Schema.Types.Mixed },   // user id or null for services
      email: { type: String },
      role: { type: String },
    },
    action: { type: String, required: true, index: true },        // e.g. 'detection.ack'
    targetType: { type: String, index: true },                    // 'detection' | 'camera' | ...
    targetId: { type: String, index: true },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String, index: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: true,
    capped: false,
    // No update paths by design — audit entries are append-only.
    strict: true,
  }
);

auditSchema.index({ action: 1, timestamp: -1 });
auditSchema.index({ 'actor.email': 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditSchema);
export default AuditLog;
