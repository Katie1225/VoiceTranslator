const express = require('express');
const axios = require('axios');

const router = express.Router();

router.post('/', async (req, res) => {
  const { text, prompt } = req.body

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
        model: 'gpt-4o',
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
    res.json({ result: summary }); // 🔥回傳統一改成 result，跟你的 App 端對齊
  } catch (error) {
    console.error('GPT 摘要錯誤:', error.toJSON ? error.toJSON() : error);
    res.status(500).json({
      error: 'GPT 摘要失敗',
      details: error.response?.data || error.message || error.toJSON(),
    });
  }
});

module.exports = router;
