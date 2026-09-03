// backend/services/soar.service.js — SOAR engine: match → incident → execute.
// 'approval' playbooks park an incident for an admin; 'auto' playbooks fire
// immediately. Every transition is audited; every execution goes through the
// same audited response-action path a human would use.
import Playbook from '../models/Playbook.js';
import Incident from '../models/Incident.js';
import { recordAction } from './response.service.js';
import { audit } from '../utils/audit.js';
import { notifyCritical } from './notification.service.js';
import { getIO } from '../config/socket.js';
import logger from '../utils/logger.js';

const emit = (ev, data) => { try { getIO().emit(ev, data); } catch { /* socket not ready */ } };

/** Default playbooks seeded once (both 'approval' mode — nothing auto-fires). */
const DEFAULT_PLAYBOOKS = [
  {
    name: 'ransomware-prelude-containment',
    description: 'Correlated ransomware prelude: isolate host + lock perimeter (human approval)',
    match: { severity: 'critical', typeContains: 'ransomware' },
    actions: [{ type: 'isolate' }, { type: 'lock_perimeter' }],
    mode: 'approval',
    priority: 10,
  },
  {
    name: 'weapon-detected-lockdown',
    description: 'Weapon detection on any camera: lock perimeter + open war room (human approval)',
    match: { severity: 'critical', typeContains: 'weapon' },
    actions: [{ type: 'lock_perimeter' }, { type: 'war_room' }],
    mode: 'approval',
    priority: 20,
  },
];

export async function seedDefaultPlaybooks() {
  try {
    for (const pb of DEFAULT_PLAYBOOKS) {
      const exists = await Playbook.findOne({ name: pb.name }).lean();
      if (!exists) await Playbook.create(pb);
    }
  } catch (err) {
    logger.warn(`Playbook seed skipped: ${err.message}`);
  }
}

const matches = (pb, event) => {
  const sevRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const evSev = sevRank[event.severity] ?? -1;
  if (evSev < sevRank[pb.match.severity]) return false;
  if (pb.match.typeContains) {
    const hay = `${event.event_type ?? ''} ${event.threat_type ?? ''} ${event.type ?? ''}`.toLowerCase();
    if (!hay.includes(pb.match.typeContains.toLowerCase())) return false;
  }
  if (pb.match.source && event.source !== pb.match.source) return false;
  return true;
};

/**
 * Entry point for correlated alerts (wired from /api/agent/correlated).
 * Creates incidents for matching enabled playbooks. Never throws.
 */
export async function onCorrelatedAlert(event) {
  try {
    const playbooks = await Playbook.find({ enabled: true }).sort({ priority: 1 }).lean();
    const hits = playbooks.filter((pb) => matches(pb, event));
    for (const pb of hits) {
      const incident = await Incident.create({
        playbook: pb._id,
        playbookName: pb.name,
        event,
        status: 'pending',
        actions: pb.actions.map((a) => ({ type: a.type, target: a.target || event.entity || 'auto', status: 'pending' })),
      });
      audit(null, 'soar.incident_created', {
        targetType: 'incident', targetId: incident._id,
        details: { playbook: pb.name, mode: pb.mode, severity: event.severity },
      });
      emit('soar:incident', incident);

      if (pb.mode === 'auto') {
        await execute(incident, null); // system-executed
      } else {
        // human gate: page the on-call about the pending decision
        notifyCritical({
          type: 'soar.pending_approval',
          severity: event.severity,
          entity: event.entity ?? '-',
          message: `Playbook "${pb.name}" matched — approval required`,
          timestamp: new Date().toISOString(),
        }, { force: true });
      }
    }
  } catch (err) {
    logger.error(`SOAR correlation failed: ${err.message}`);
  }
}

/** Execute an incident's actions through the audited response path. */
async function execute(incident, user) {
  for (const action of incident.actions) {
    try {
      await recordAction(action.type, action.target, user?._id ?? user?.id ?? null);
      action.status = 'done';
    } catch (err) {
      action.status = 'failed';
      action.result = String(err.message).slice(0, 200);
    }
  }
  incident.status = incident.actions.every((a) => a.status === 'done') ? 'executed' : 'failed';
  incident.executedAt = new Date();
  await incident.save();
  emit('soar:incident', incident);
  return incident;
}

export async function approveIncident(id, req) {
  const incident = await Incident.findById(id);
  if (!incident) throw { statusCode: 404, message: 'Incident not found' };
  if (incident.status !== 'pending') throw { statusCode: 409, message: `Incident already ${incident.status}` };
  incident.status = 'approved';
  incident.decidedBy = req.user?.id ?? null;
  incident.decidedAt = new Date();
  await incident.save();
  audit(req, 'soar.approve', { targetType: 'incident', targetId: id, details: { playbook: incident.playbookName } });
  return execute(incident, req.user);
}

export async function rejectIncident(id, req) {
  const incident = await Incident.findById(id);
  if (!incident) throw { statusCode: 404, message: 'Incident not found' };
  if (incident.status !== 'pending') throw { statusCode: 409, message: `Incident already ${incident.status}` };
  incident.status = 'rejected';
  incident.decidedBy = req.user?.id ?? null;
  incident.decidedAt = new Date();
  await incident.save();
  audit(req, 'soar.reject', { targetType: 'incident', targetId: id, details: { playbook: incident.playbookName } });
  emit('soar:incident', incident);
  return incident;
}
