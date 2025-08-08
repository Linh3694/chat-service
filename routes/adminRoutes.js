const express = require('express');
const router = express.Router();

// Optional dependencies - keep robust with try/catch
let database, redisClient, frappeService;
try { database = require('../config/database'); } catch {}
try { redisClient = require('../config/redis'); } catch {}
try { frappeService = require('../services/frappeService'); } catch {}

// Basic admin info
router.get('/', (req, res) => {
  res.json({
    service: process.env.SERVICE_NAME || 'chat-service',
    env: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Aggregated health (duplicated but scoped under /api/admin)
router.get('/health', async (req, res) => {
  const status = {
    service: process.env.SERVICE_NAME || 'chat-service',
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  try {
    if (database?.healthCheck) {
      await database.healthCheck();
      status.database = 'connected';
    }
  } catch (e) {
    status.database = 'error';
    status.database_error = e?.message;
  }

  try {
    if (redisClient?.client?.ping) {
      await redisClient.client.ping();
      status.redis = 'connected';
    }
  } catch (e) {
    status.redis = 'error';
    status.redis_error = e?.message;
  }

  try {
    if (frappeService?.healthCheck) {
      const h = await frappeService.healthCheck();
      status.frappe = h?.status || 'unknown';
      if (h?.status === 'error') status.frappe_error = h?.message;
    }
  } catch (e) {
    status.frappe = 'error';
    status.frappe_error = e?.message;
  }

  const critical = ['database', 'redis'];
  const degraded = critical.some((k) => status[k] === 'error');
  status.status = degraded ? 'degraded' : 'ok';
  res.status(degraded ? 503 : 200).json(status);
});

// Flush Redis caches (best effort)
router.post('/cache/flush', async (req, res) => {
  try {
    if (redisClient?.client?.flushAll) {
      await redisClient.client.flushAll();
      return res.json({ status: 'success', action: 'flushAll' });
    }
    return res.status(501).json({ status: 'not_implemented' });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e?.message });
  }
});

module.exports = router;


