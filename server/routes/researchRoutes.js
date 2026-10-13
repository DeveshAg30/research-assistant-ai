const express = require('express');
const {
  getHistory,
  getReportById,
  toggleBookmark,
  getSession,
} = require('../controllers/researchController');
const { streamQuery } = require('../controllers/queryController');
const requireAuth = require('../middleware/requireAuth');
const { queryLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/query/stream', requireAuth, queryLimiter, streamQuery);
router.get('/history', requireAuth, getHistory);
router.get('/history/:id', requireAuth, getReportById);
router.patch('/history/:id/bookmark', requireAuth, toggleBookmark);
router.get('/sessions/:id', requireAuth, getSession);

module.exports = router;
