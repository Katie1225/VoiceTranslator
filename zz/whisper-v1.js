const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
//const ffmpeg = require('fluent-ffmpeg');
const OpenCC = require('opencc-js');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('audio'), async (req, res) => {
        console.log(' whisper-v1:'); 
  const audioFile = req.file;
  if (!audioFile) {
    return res.status(400).json({ error: '沒有收到音檔' });
  }

 // const wavPath = audioFile.path + '.wav';

  try {
    // 轉成 wav 格式
  /*  await new Promise((resolve, reject) => {
      ffmpeg(audioFile.path)
        .toFormat('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(wavPath);
    }); */

    // 上傳到 4o
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioPath));
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('response_format', 'json');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Project': `${process.env.OPENAI_PROJECT_ID}`,
        },
      }
    );

    // 清除暫存音檔
    fs.unlinkSync(audioFile.path);
 //   fs.unlinkSync(wavPath);

// 加上讀取語言設定
const { targetLang = 'tw' } = req.body;

// 動態轉換器
const opencc = OpenCC.Converter({ from: 'cn', to: targetLang });

const rawText = response.data.text;
const convertedText = opencc(rawText); // 不判斷來源，永遠轉換
res.json({ text: convertedText.trim() });

  } catch (error) {
    fs.unlinkSync(audioFile.path);
   // if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    console.error('Whisper 錯誤:', error.toJSON ? error.toJSON() : error);

    res.status(500).json({
      error: 'Whisper API 失敗',
      details: error.response?.data || error.message || error.toJSON(),
    });
  }
});

// ✅ 後端自己讀 welcontoVoicenote.wav 並送去 Whisper
router.post('/welcome', async (req, res) => {
  const path = require('path');
  const filePath = path.join(__dirname, 'welcontoVoicenote.wav');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '找不到 welcontoVoicenote.wav' });
  }

  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('response_format', 'json');
    formData.append('temperature', '0');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'OpenAI-Project': `${process.env.OPENAI_PROJECT_ID}`,
        },
      }
    );

    // 不做中文轉換，直接回傳英文
    const rawText = response.data.text;
    res.json({ text: rawText.trim() });

  } catch (error) {
    console.error('Whisper 歡迎音檔錯誤:', error);
    res.status(500).json({
      error: 'Whisper 歡迎音檔處理失敗',
      details: error.response?.data || error.message,
    });
  }
});


module.exports = router;
