// backend/models/Playbook.js — SOAR automation rules.
import mongoose from 'mongoose';

const actionTypeEnum = [
  'isolate', 'block', 'lock', 'escalate', 'auto',
  'lock_perimeter', 'quarantine', 'freeze_badge', 'throttle', 'war_room',
];

const playbookSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    // When a correlated alert matches, the playbook fires.
    match: {
      severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
      // substring match against event_type/threat_type (case-insensitive)
      typeContains: { type: String, default: '' },
      // optional source filter (e.g. 'agent')
      source: { type: String, default: '' },
    },
    actions: {
      type: [{ type: { type: String, enum: actionTypeEnum }, target: { type: String, default: '' } }],
      validate: [(v) => v.length > 0, 'at least one action is required'],
    },
    // 'approval' = a human approves before execution (default, safe)
    // 'auto'     = execute immediately when matched
    mode: { type: String, enum: ['approval', 'auto'], default: 'approval' },
    priority: { type: Number, default: 100 },
  },
  { timestamps: true }
);

playbookSchema.index({ enabled: 1, priority: 1 });

export default mongoose.model('Playbook', playbookSchema);
