// backend/models/Incident.js — SOAR incident (playbook firing).
import mongoose from 'mongoose';

const incidentSchema = new mongoose.Schema(
  {
    playbook: { type: mongoose.Schema.Types.ObjectId, ref: 'Playbook', required: true, index: true },
    playbookName: { type: String, required: true },
    // snapshot of the triggering event (immutable evidence)
    event: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'executed', 'failed'],
      default: 'pending',
      index: true,
    },
    actions: [{
      type: String,
      target: String,
      status: { type: String, enum: ['pending', 'done', 'failed'], default: 'pending' },
      result: String,
    }],
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    executedAt: { type: Date },
  },
  { timestamps: true }
);

incidentSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Incident', incidentSchema);
