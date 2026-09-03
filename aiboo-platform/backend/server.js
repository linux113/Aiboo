import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import http from 'http';

import { connectDB } from './config/db.js';
import { initSocket } from './config/socket.js';
import socketHandler from './sockets/index.js';
import { errorHandler } from './middleware/error.js';
import { assertProductionSecrets } from './middleware/security.js';
// ✅ Import all limiters (auth, api, agent)
import { authLimiter, apiLimiter, agentLimiter } from './middleware/rateLimiter.js';
import logger from './utils/logger.js';

import authRoutes from './routes/auth.routes.js';
import threatRoutes from './routes/threat.routes.js';
import cameraRoutes from './routes/camera.routes.js';
import assetRoutes from './routes/asset.routes.js';
import identityRoutes from './routes/identity.routes.js';
import responseRoutes from './routes/response.routes.js';
import aiRoutes from './routes/ai.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import agentRoutes, { seedDemoAgentData, hydrateStoreFromMongo } from './routes/agent.routes.js';
import auditRoutes from './routes/audit.routes.js';
import { requestId } from './middleware/requestId.js';
import { openapiSpec } from './docs/swagger.js';

// Fail fast on known-default secrets before anything binds a port.
assertProductionSecrets();

// ❌ Outbound WebSocket import removed – agents push via HTTP.

const app = express();

// ---- CORS configuration ----
let corsOrigins;
if (process.env.NODE_ENV === 'development') {
  corsOrigins = '*';
} else {
  corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'];
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
}));
app.set('trust proxy', process.env.TRUST_PROXY || 1);

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
}));
app.use(hpp());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

// Strip Mongo operators ($gt, $ne, $where…) from user input — NoSQL injection
// defence. Runs after body/cookie parsing, before validation.
app.use(mongoSanitize());

// Correlation IDs — every request gets an id (propagated from nginx if present)
app.use(requestId);

app.use((req, res, next) => {
  logger.info({ reqId: req.requestId }, `${req.method} ${req.originalUrl}`);
  next();
});

// ---- Health & root (no rate limiting) ----
app.get('/', (req, res) => res.json({ service: 'AiBoO Backend', status: 'running' }));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ---- API documentation (Swagger UI) ----
// Public in development; admin-only in production unless PUBLIC_DOCS=true.
const docsEnabled = process.env.DOCS_ENABLED !== 'false';
if (docsEnabled) {
  const swaggerUi = (await import('swagger-ui-express')).default;
  const docsGuard =
    process.env.NODE_ENV === 'production' && process.env.PUBLIC_DOCS !== 'true'
      ? protect
      : (req, res, next) => next();
  const { authorize: docsAuthorize } = await import('./middleware/auth.js');
  app.use(
    '/api/docs',
    docsGuard,
    process.env.NODE_ENV === 'production' && process.env.PUBLIC_DOCS !== 'true'
      ? docsAuthorize('admin', 'analyst')
      : (req, res, next) => next(),
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, { customSiteTitle: 'AiBoO API Docs' })
  );
  app.get('/api/docs.json', (req, res) => res.json(openapiSpec)); // spec for codegen
}

// ---- Routes with appropriate rate limiters ----
app.use('/api/auth', authLimiter, authRoutes);                // Strict (20 per 15min)
app.use('/api/threats', apiLimiter, threatRoutes);
app.use('/api/cameras', apiLimiter, cameraRoutes);
app.use('/api/assets', apiLimiter, assetRoutes);
app.use('/api/identities', apiLimiter, identityRoutes);
app.use('/api/respond', apiLimiter, responseRoutes);
app.use('/api/ai', apiLimiter, aiRoutes);
app.use('/api/dashboard', apiLimiter, dashboardRoutes);
app.use('/api/audit', apiLimiter, auditRoutes);

// ✅ Agent routes now use agentLimiter (more permissive)
app.use('/api/agent', agentLimiter, agentRoutes);

// ---- 404 & error handling ----
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found' }));
app.use(errorHandler);

// ---- Socket.io setup ----
const server = http.createServer(app);
const io = initSocket(server);
socketHandler(io);

// ❌ Outbound WebSocket connection to agent is completely removed.
// Remote agents push findings via HTTP POST to /api/agent/findings.

// ---- Start server ----
const PORT = process.env.PORT || 4000;

const startServer = async () => {
  try {
    await connectDB();
    if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true') {
      seedDemoAgentData();
    }
    // Rehydrate in-memory agent store from Mongo (restart-safe findings).
    // Non-blocking: a slow Mongo must never delay the port opening / healthcheck.
    hydrateStoreFromMongo();
    server.listen(PORT, () => {
      logger.info(`AiBoO Backend running on port ${PORT}`);
    });
  } catch (error) {
    logger.error(`Server start failed: ${error.message}`);
    process.exit(1);
  }
};

// ---- Graceful shutdown ----
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed');
  });
  const mongoose = (await import('mongoose')).default;
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();