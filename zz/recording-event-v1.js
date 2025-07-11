const express = require('express');
const router = express.Router();
      console.log(' recording-event-v1:'); 
  
router.post('/', async (req, res) => {
  const { type, timestamp, userId, fileName } = req.body;
  console.log(`🟢 綠燈收到錄音事件:`, { type, timestamp, userId, fileName });
  res.json({ status: 'ok', source: 'green', type });
});

module.exports = router;