// backend/schemas/index.js — Zod request schemas (single source of truth for
// API input contracts; keep in sync with models & CV detection map).
import { z } from 'zod';

export const severityEnum = z.enum(['low', 'medium', 'high', 'critical']);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'password must be at least 8 characters').max(128),
  // NOTE: role is deliberately NOT accepted from public input (self-escalation).
  // First registered user becomes admin; everyone else is an analyst.
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

// Detection types actually produced by the CV service (COCO classes mapped +
// custom detectors) and the backend simulate endpoint. The old 12-value Mongoose
// enum silently DROPPED fire/smoke/tamper/fall/... detections — keep this list
// a superset until Detection.type moves to a free string + display map.
export const detectionTypeEnum = z.enum([
  // COCO-mapped
  'person', 'vehicle', 'animal', 'bag', 'device', 'weapon', 'sports',
  'food', 'indoor', 'outdoor', 'electronics',
  // legacy backend enum
  'weapon_gun', 'weapon_knife', 'face_known', 'face_unknown', 'face_watchlist',
  'crowd', 'behavior_anomaly', 'breach',
  // CV custom detectors
  'fire', 'smoke', 'abandoned_object', 'fall', 'tamper', 'tripwire',
  'line_cross', 'traffic_anomaly', 'traffic', 'night_mode', 'zone_breach',
  'group', 'loitering', 'speed', 'face',
]);

export const detectionIngestSchema = z.object({
  cameraId: z.union([z.string().min(1), z.number()]).nullish(),
  cameraName: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  type: detectionTypeEnum,
  severity: severityEnum.default('low'),
  // Accept CV's 0–1 floats OR backend 0–100 (normalized in the service).
  confidence: z.number().min(0).max(100).default(0),
  label: z.string().trim().max(200).optional(),
  boundingBox: z.object({
    x: z.number(), y: z.number(), width: z.number(), height: z.number(),
  }).partial().optional(),
  snapshotUrl: z.string().trim().max(500).optional(),
  metadata: z.record(z.any()).optional(),
});

export const cameraCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).optional(),
  streamUrl: z.string().trim().min(1).max(500),
  enabled: z.boolean().optional(),
});

export const cameraUpdateSchema = cameraCreateSchema.partial();

export const agentFindingSchema = z.object({
  agent_name: z.string().trim().min(1).max(120).default('UnknownAgent'),
  threat_type: z.string().trim().min(1).max(120),
  severity: severityEnum,
  confidence: z.number().min(0).max(1).default(0.5),
  summary: z.string().trim().min(1).max(2000).default('No summary provided'),
  actions: z.array(z.string().max(300)).max(20).default([]),
  metadata: z.record(z.any()).optional(),
});

export const threatCreateSchema = z.object({
  severity: severityEnum,
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  asset: z.string().trim().max(200).optional(),
  source: z.enum(['firewall', 'camera', 'va-scan', 'agent', 'cv-service', 'siem', 'manual']),
  status: z.enum(['open', 'investigating', 'resolved']).optional(),
});

// Response actions: controllers validate their own required field (ip/zone/
// threatId) — the schema constrains the common optional fields and passes
// controller-specific ones through untouched.
export const responseActionSchema = z
  .object({
    ip: z.string().trim().max(64).optional(),
    zone: z.string().trim().max(120).optional(),
    threatId: z.string().trim().max(64).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .passthrough()
  .refine((b) => !(b.ip === undefined && b.zone === undefined && b.threatId === undefined), {
    message: 'at least one of ip, zone or threatId is required',
  });
