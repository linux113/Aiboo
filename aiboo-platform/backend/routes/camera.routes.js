import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { serviceAuth } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { cameraCreateSchema, cameraUpdateSchema, detectionIngestSchema } from '../schemas/index.js';
import { audit } from '../utils/audit.js';
import {
  getCameras, addCamera, updateCamera, deleteCamera, toggleCamera,
  getDetections, postDetection, ackDetection, escalateDetection, triggerDetection
} from '../controllers/camera.controller.js';

const router = express.Router();

// Camera CRUD
router.get('/',         protect, getCameras);
router.post('/',        protect, authorize('admin','analyst'), validate({ body: cameraCreateSchema }), addCamera);
router.put('/:id',      protect, authorize('admin','analyst'), validate({ body: cameraUpdateSchema }), updateCamera);
router.delete('/:id',   protect, authorize('admin'), (req, res, next) => { audit(req, 'camera.delete', { targetType: 'camera', targetId: req.params.id }); next(); }, deleteCamera);
router.patch('/:id/toggle', protect, authorize('admin','analyst'), (req, res, next) => { audit(req, 'camera.toggle', { targetType: 'camera', targetId: req.params.id, details: { enabled: req.body?.enabled } }); next(); }, toggleCamera);

// Detections — ingest authenticated with X-API-Key (CV_INGEST_KEY) when configured.
// serviceAuth allows unauthenticated posts in dev only when CV_INGEST_KEY is unset.
router.get('/detections',                   protect, getDetections);
router.post('/detections',                  serviceAuth, validate({ body: detectionIngestSchema }), postDetection);   // CV service posts here
router.patch('/detections/:id/ack',         protect, (req, res, next) => { audit(req, 'detection.ack', { targetType: 'detection', targetId: req.params.id }); next(); }, ackDetection);
router.patch('/detections/:id/escalate',    protect, (req, res, next) => { audit(req, 'detection.escalate', { targetType: 'detection', targetId: req.params.id }); next(); }, escalateDetection);

// Trigger simulated AI detection
router.post('/:id/detect', protect, (req, res, next) => { audit(req, 'camera.simulate_detect', { targetType: 'camera', targetId: req.params.id }); next(); }, triggerDetection);

export default router;
