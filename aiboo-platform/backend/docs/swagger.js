// backend/docs/swagger.js — OpenAPI 3.0 spec for the AiBoO public API.
// Served at /api/docs (admin-only in production unless PUBLIC_DOCS=true).
// Keep in sync with routes + schemas/index.js.

const severity = {
  name: 'severity',
  schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  in: 'query',
};

const bearer = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'AiBoO Platform API',
    version: '1.0.0',
    description:
      'AI-driven Cyber-Physical Security Operations Platform. ' +
      'Auth: Bearer JWT (users) or X-API-Key (services). ' +
      'All responses carry an X-Request-Id correlation header.',
  },
  servers: [{ url: '/', description: 'same-origin via nginx proxy' }],
  tags: [
    { name: 'Auth', description: 'Register / login / token lifecycle' },
    { name: 'Cameras', description: 'Camera CRUD + detection ingest' },
    { name: 'Threats', description: 'Threat management' },
    { name: 'Agent', description: 'Remote agent ingest + console data' },
    { name: 'Respond', description: 'Response & orchestration actions (audited)' },
    { name: 'Audit', description: 'Immutable audit trail (admin)' },
  ],

  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          validation: { type: 'boolean', description: 'true for Zod 400s' },
          issues: {
            type: 'array',
            items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1 } },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'short-lived access JWT' },
          user: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } },
        },
      },
      DetectionIngest: {
        type: 'object',
        required: ['type'],
        properties: {
          cameraId: { type: 'string' },
          cameraName: { type: 'string' },
          location: { type: 'string' },
          type: {
            type: 'string',
            description: 'COCO-mapped, legacy or custom CV detector type',
            enum: [
              'person', 'vehicle', 'animal', 'bag', 'device', 'weapon', 'sports', 'food', 'indoor', 'outdoor', 'electronics',
              'weapon_gun', 'weapon_knife', 'face_known', 'face_unknown', 'face_watchlist', 'crowd', 'behavior_anomaly', 'breach',
              'fire', 'smoke', 'abandoned_object', 'fall', 'tamper', 'tripwire', 'line_cross', 'traffic_anomaly', 'traffic',
              'night_mode', 'zone_breach', 'group', 'loitering', 'speed', 'face',
            ],
          },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
          confidence: { type: 'number', minimum: 0, maximum: 100, description: '0–100 (0–1 inputs are normalised)' },
          label: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      AgentFinding: {
        type: 'object',
        required: ['threat_type', 'severity'],
        properties: {
          agent_name: { type: 'string', default: 'UnknownAgent' },
          threat_type: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          confidence: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
          summary: { type: 'string' },
          actions: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      Threat: {
        type: 'object',
        required: ['severity', 'title', 'source'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          description: { type: 'string' },
          asset: { type: 'string' },
          source: { type: 'string', enum: ['firewall', 'camera', 'va-scan', 'agent', 'cv-service', 'siem', 'manual'] },
          status: { type: 'string', enum: ['open', 'investigating', 'resolved'], default: 'open' },
        },
      },
      AuditEntry: {
        type: 'object',
        properties: {
          actor: { type: 'object', properties: { id: {}, email: { type: 'string' }, role: { type: 'string' } } },
          action: { type: 'string', example: 'response.isolate' },
          targetType: { type: 'string' },
          targetId: { type: 'string' },
          ip: { type: 'string' },
          requestId: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  paths: {
    '/api/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Register a user', security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: { '201': { description: 'Created (sets refresh cookie)' }, '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Login (20 req / 15 min / IP)', security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: {
          '200': { description: 'Access token + httpOnly refresh cookie', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'], summary: 'Rotate refresh cookie → new access token (single-use)', security: [],
        responses: { '200': { description: 'New access token + rotated cookie' }, '401': { description: 'Missing/revoked/replayed refresh cookie' } },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'], summary: 'Revoke access + refresh tokens', security: bearer,
        responses: { '200': { description: 'Revoked' } },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user', security: bearer, responses: { '200': { description: 'User profile' }, '401': { description: 'Unauthorized' } } },
    },

    '/api/cameras': {
      get: { tags: ['Cameras'], summary: 'List cameras', security: bearer, responses: { '200': { description: 'Camera list' } } },
      post: {
        tags: ['Cameras'], summary: 'Add camera (admin/analyst)', security: bearer,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'streamUrl'], properties: { name: { type: 'string' }, streamUrl: { type: 'string' }, location: { type: 'string' }, enabled: { type: 'boolean' } } } } } },
        responses: { '201': { description: 'Created' }, '400': { description: 'Validation' } },
      },
    },
    '/api/cameras/detections': {
      get: { tags: ['Cameras'], summary: 'List detections', security: bearer, parameters: [{ name: 'limit', schema: { type: 'integer' }, in: 'query' }], responses: { '200': { description: 'Detections' } } },
      post: {
        tags: ['Cameras'], summary: 'Ingest a detection (CV service)',
        description: 'Authenticated with X-API-Key (CV_INGEST_KEY). Critical types emit `alert:critical` over Socket.IO.',
        security: [{ apiKeyAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DetectionIngest' } } } },
        responses: { '201': { description: 'Stored + broadcast' }, '400': { description: 'Validation' }, '401': { description: 'Missing/invalid service key' } },
      },
    },
    '/api/cameras/detections/{id}/ack': {
      patch: { tags: ['Cameras'], summary: 'Acknowledge a detection (audited)', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Acknowledged' } } },
    },
    '/api/cameras/detections/{id}/escalate': {
      patch: { tags: ['Cameras'], summary: 'Escalate a detection (audited)', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Escalated to critical' } } },
    },

    '/api/threats': {
      get: { tags: ['Threats'], summary: 'List/filter threats', security: bearer, parameters: [severity, { name: 'status', schema: { type: 'string', enum: ['open', 'investigating', 'resolved'] }, in: 'query' }], responses: { '200': { description: 'Threats' } } },
      post: { tags: ['Threats'], summary: 'Create a threat (admin/analyst, audited)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Threat' } } } }, responses: { '201': { description: 'Created' } } },
    },
    '/api/threats/{id}': {
      get: { tags: ['Threats'], summary: 'Get a threat', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Threat' } } },
      patch: { tags: ['Threats'], summary: 'Update status etc. (audited)', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Updated' } } },
    },

    '/api/agent/findings': {
      post: {
        tags: ['Agent'], summary: 'Agent pushes a finding (X-API-Key: AGENT_API_KEY)',
        security: [{ apiKeyAuth: [] }],
        parameters: [{ name: 'X-Endpoint-Id', schema: { type: 'string' }, in: 'header', description: 'endpoint identity for the live-sources map' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/AgentFinding' } } } },
        responses: { '201': { description: 'Stored (Mongo write-through) + broadcast' }, '400': { description: 'Validation' }, '401': { description: 'Invalid key' } },
      },
      get: { tags: ['Agent'], summary: 'Recent findings (optionally by source)', security: [], parameters: [{ name: 'source', schema: { type: 'string' }, in: 'query' }, { name: 'limit', schema: { type: 'integer', default: 50 }, in: 'query' }], responses: { '200': { description: 'Findings' } } },
    },
    '/api/agent/heartbeat': {
      post: { tags: ['Agent'], summary: 'Keep an endpoint live (<2 min window)', security: [{ apiKeyAuth: [] }], responses: { '200': { description: 'Heartbeat recorded' } } },
    },
    '/api/agent/correlated': {
      post: {
        tags: ['Agent'], summary: 'Report a correlated alert (materialises as Threat)',
        description: 'Critical/high alerts emit `alert:critical` and persist a Threat document with source=agent.',
        security: bearer,
        responses: { '200': { description: 'Accepted' } },
      },
    },
    '/api/agent/stats': {
      get: { tags: ['Agent'], summary: 'Agent store stats', security: bearer, responses: { '200': { description: 'Counts by severity/type' } } },
    },

    '/api/respond/isolate': {
      post: { tags: ['Respond'], summary: 'Isolate a host by IP (audited)', security: bearer, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ip'], properties: { ip: { type: 'string' }, reason: { type: 'string' } } } } } }, responses: { '201': { description: 'ResponseAction created' } } },
    },
    '/api/respond/war-room': {
      post: { tags: ['Respond'], summary: 'Open a war room (audited)', security: bearer, responses: { '201': { description: 'ResponseAction created' } } },
    },

    '/api/audit': {
      get: {
        tags: ['Audit'], summary: 'Query the audit trail (admin)',
        security: bearer,
        parameters: [
          { name: 'action', schema: { type: 'string' }, in: 'query' },
          { name: 'email', schema: { type: 'string' }, in: 'query' },
          { name: 'limit', schema: { type: 'integer', default: 50, maximum: 200 }, in: 'query' },
          { name: 'page', schema: { type: 'integer', default: 1 }, in: 'query' },
        ],
        responses: {
          '200': { description: 'Paginated audit entries', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/AuditEntry' } }, total: { type: 'integer' } } } } } },
          '403': { description: 'Non-admin role' },
        },
      },
    },

    '/api/notifications/channels': {
      get: { tags: ['Respond'], summary: 'Configured alert channels + queue depth (admin)', security: bearer, responses: { '200': { description: 'Channel status list' } } },
    },
    '/api/notifications/test': {
      post: {
        tags: ['Respond'], summary: 'Force a test alert through every channel (audited)',
        description: 'Delivers a `notification.test` critical event to Slack / PagerDuty / generic webhook / SIEM CEF — bypasses dedupe.',
        security: bearer,
        responses: { '202': { description: 'Queued' } },
      },
    },
    '/api/notifications/history': {
      get: { tags: ['Respond'], summary: 'Recent dispatch results (sent/failed)', security: bearer, responses: { '200': { description: 'Dispatch history' } } },
    },

    '/api/intel/status': {
      get: { tags: ['Threats'], summary: 'Configured threat-intel sources', security: bearer, responses: { '200': { description: 'Enabled sources + cache size' } } },
    },
    '/api/intel/lookup': {
      get: {
        tags: ['Threats'], summary: 'Look up an IP or file hash (AbuseIPDB/VirusTotal/MISP)',
        security: bearer,
        parameters: [
          { name: 'ip', schema: { type: 'string' }, in: 'query', description: 'public IPv4' },
          { name: 'hash', schema: { type: 'string' }, in: 'query', description: 'md5/sha1/sha256' },
        ],
        responses: { '200': { description: 'Aggregated verdict per source' }, '400': { description: 'Validation' } },
      },
    },

    '/api/soar/incidents': {
      get: { tags: ['Respond'], summary: 'SOAR incidents (filter by status)', security: bearer, parameters: [{ name: 'status', schema: { type: 'string', enum: ['pending', 'approved', 'rejected', 'executed', 'failed'] }, in: 'query' }], responses: { '200': { description: 'Incidents' } } },
    },
    '/api/soar/incidents/{id}/approve': {
      post: { tags: ['Respond'], summary: 'Approve & execute a pending incident (admin, audited)', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Executed incident' }, '409': { description: 'Already decided' } } },
    },
    '/api/soar/incidents/{id}/reject': {
      post: { tags: ['Respond'], summary: 'Reject a pending incident (admin, audited)', security: bearer, parameters: [{ name: 'id', required: true, schema: { type: 'string' }, in: 'path' }], responses: { '200': { description: 'Rejected incident' } } },
    },
    '/api/soar/playbooks': {
      get: { tags: ['Respond'], summary: 'List SOAR playbooks', security: bearer, responses: { '200': { description: 'Playbooks' } } },
      post: {
        tags: ['Respond'], summary: 'Create a playbook (admin)',
        security: bearer,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object', required: ['name', 'match', 'actions'],
                properties: {
                  name: { type: 'string' },
                  match: { type: 'object', required: ['severity'], properties: { severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }, typeContains: { type: 'string' }, source: { type: 'string' } } },
                  actions: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { type: 'string' }, target: { type: 'string' } } } },
                  mode: { type: 'string', enum: ['approval', 'auto'], default: 'approval' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },

    '/health': {
      get: { tags: ['Auth'], summary: 'Liveness probe', security: [], responses: { '200': { description: 'ok' } } },
    },
  },
};
