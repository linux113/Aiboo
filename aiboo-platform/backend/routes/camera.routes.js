import express from 'express';
import { protect, authorize } from '../middleware/auth.js';
import { serviceAuth } from '../middleware/security.js';
import {
  getCameras, addCamera, updateCamera, deleteCamera, toggleCamera,
  getDetections, postDetection, ackDetection, escalateDetection, triggerDetection
} from '../controllers/camera.controller.js';

const router = express.Router();

// Camera CRUD
router.get('/',         protect, getCameras);
router.post('/',        protect, authorize('admin','analyst'), addCamera);
router.put('/:id',      protect, authorize('admin','analyst'), updateCamera);
router.delete('/:id',   protect, authorize('admin'), deleteCamera);
router.patch('/:id/toggle', protect, authorize('admin','analyst'), toggleCamera);

// Detections — ingest authenticated with X-API-Key (CV_INGEST_KEY) when configured.
// serviceAuth allows unauthenticated posts in dev only when CV_INGEST_KEY is unset.
router.get('/detections',                   protect, getDetections);
router.post('/detections',                  serviceAuth, postDetection);   // CV service posts here
router.patch('/detections/:id/ack',         protect, ackDetection);
router.patch('/detections/:id/escalate',    protect, escalateDetection);

// Trigger simulated AI detection
router.post('/:id/detect', protect, triggerDetection);

export default router;
