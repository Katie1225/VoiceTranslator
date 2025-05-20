const express = require('express');
const cors = require('cors');
require('dotenv').config();

const whisperRoute = require('./whisper');
const summarizeRoute = require('./summarize');
const iapRoute = require('./iap-redeem'); 

const app = express();
app.use(cors());
app.use(express.json()); // for JSON parsing from POST body

app.get('/ping', (req, res) => {
  console.log('✅ 收到 /ping');
  res.send('✅ V0 ping OK');
});

// 路由
app.use('/transcribe', whisperRoute);
app.use('/summarize', summarizeRoute);
app.use('/iap-redeem', iapRoute);

// 啟動伺服器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`V0 藍燈伺服器啟動：http://localhost:${PORT}`);
});

