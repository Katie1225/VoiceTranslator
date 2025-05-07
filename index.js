const express = require('express');
const cors = require('cors');
require('dotenv').config();

const whisperRoute = require('./whisper');
const summarizeRoute = require('./summarize');

const app = express();
app.use(cors());
app.use(express.json()); // for JSON parsing from POST body

// 路由
app.use('/transcribe', whisperRoute);
app.use('/summarize', summarizeRoute);

// 啟動伺服器
app.listen(3000, () => {
  console.log('伺服器啟動：http://localhost:3000');
});
