const express = require('express');
const axios = require('axios');
const OpenCC = require('opencc-js');

const router = express.Router();
router.post('/', async (req, res) => {
      console.log(' summarize-v1:'); 
  const { text, prompt, targetLang = 'tw' } = req.body;

  if (!text) {
    return res.status(400).json({ error: '缺少逐字稿內容' });
  }

  if (!prompt) {
    return res.status(400).json({ error: '缺少指令 prompt' });
  }

  try {
    const gptResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: prompt }, // 🔥 用傳進來的 prompt
          { role: 'user', content: `以下是逐字稿：\n\n${text}` },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const summary = gptResponse.data.choices[0].message.content;

    // ✅ 強制轉換為指定語言
    const opencc = OpenCC.Converter({ from: 'cn', to: targetLang });
    const convertedSummary = opencc(summary);

    res.json({ result: convertedSummary }); // ✅ 回傳轉換後的文字
  } catch (error) {
    console.error('GPT 摘要錯誤:', error.toJSON ? error.toJSON() : error);
    res.status(500).json({
      error: 'GPT 摘要失敗',
      details: error.response?.data || error.message || error.toJSON(),
    });
  }
});

module.exports = router;
