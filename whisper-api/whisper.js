const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('audio'), async (req, res) => {
  const audioFile = req.file;
  if (!audioFile) {
    return res.status(400).json({ error: '沒有收到音檔' });
  }

  const wavPath = audioFile.path + '.wav';

  try {
    // 轉成 wav 格式
    await new Promise((resolve, reject) => {
      ffmpeg(audioFile.path)
        .toFormat('wav')
        .on('end', resolve)
        .on('error', reject)
        .save(wavPath);
    });

    // 上傳到 Whisper API
    const formData = new FormData();
    formData.append('file', fs.createReadStream(wavPath));
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    formData.append('language', 'zh');
    formData.append('prompt', '<只識別對話，忽略任何字幕來源、轉發提示、廣告內容>');

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

    // 清除雜訊詞
    const rawText = response.data.text;
    const adKeywords = ['字幕由', 'Amara.org', '請不點贊', '轉發', '打賞支持', '明鏡與點點'];
    const cleanText = adKeywords.reduce(
      (acc, keyword) => acc.replace(new RegExp(keyword, 'g'), ''),
      rawText
    );

    // 清除暫存音檔
    fs.unlinkSync(audioFile.path);
    fs.unlinkSync(wavPath);

    res.json({ text: cleanText.trim() });
  } catch (error) {
    fs.unlinkSync(audioFile.path);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);

    console.error('Whisper 錯誤:', error.toJSON ? error.toJSON() : error);

    res.status(500).json({
      error: 'Whisper API 失敗',
      details: error.response?.data || error.message || error.toJSON(),
    });
  }
});

module.exports = router;
