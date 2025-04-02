const express = require('express');
const axios = require('axios');

const router = express.Router();

router.post('/', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: '缺少逐字稿內容' });
  }

  try {
    const gptResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              '你是一位專業會議助理，請從逐字稿中整理出會議摘要與行動項目（action items），用條列式格式呈現。',
          },
          {
            role: 'user',
            content: `以下是逐字稿：\n\n${text}`,
          },
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
    res.json({ summary });
  } catch (error) {
    console.error('GPT 摘要錯誤:', error.toJSON ? error.toJSON() : error);
    res.status(500).json({
      error: 'GPT 摘要失敗',
      details: error.response?.data || error.message || error.toJSON(),
    });
  }
});

module.exports = router;
