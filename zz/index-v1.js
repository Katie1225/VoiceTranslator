const express = require('express');
const cors = require('cors');
require('dotenv').config();

const whisperRoute = require('./whisper-v1');
const summarizeRoute = require('./summarize-v1');
const iapRoute = require('./iap-redeem-v1'); 
const recordingRouteV1 = require('./recording-event-v1');

const app = express();
app.use(cors());
app.use(express.json()); // for JSON parsing from POST body

app.get('/v1/ping', (req, res) => {
  console.log('✅ 收到 /v1/ping');
  res.send('✅ V1 ping OK');
});

// 路由
app.use('/v1/transcribe', whisperRoute);
app.use('/v1/summarize', summarizeRoute);
app.use('/v1/iap-redeem', iapRoute);
app.use('/v1/recording-event', recordingRouteV1);

// 啟動伺服器
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`V1 綠燈伺服器啟動：http://localhost:${PORT}`);
});

