const express = require('express');
const {
  submitQuery,
  getHistory,
  getReportById,
  toggleBookmark,
} = require('../controllers/researchController');

const router = express.Router();

router.post('/query', submitQuery);
router.get('/history', getHistory);
router.get('/history/:id', getReportById);
router.patch('/history/:id/bookmark', toggleBookmark);

module.exports = router;
