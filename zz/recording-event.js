const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  const { type, timestamp, userId, fileName } = req.body;
  console.log(`🔵 藍燈收到錄音事件:`, { type, timestamp, userId, fileName });
  res.json({ status: 'ok', source: 'blue', type });
});

module.exports = router;