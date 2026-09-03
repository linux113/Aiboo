import mongoose from 'mongoose';

const responseActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      // core actions + orchestration actions invoked from the dashboard
      enum: ['isolate', 'block', 'lock', 'escalate', 'auto', 'lock_perimeter', 'quarantine', 'freeze_badge', 'throttle', 'war_room'],
      required: true,
    },
    target: { type: String, required: true },
    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  },
  { timestamps: true }
);

export default mongoose.model('ResponseAction', responseActionSchema);
