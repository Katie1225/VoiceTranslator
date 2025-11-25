// translate-v1.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { text, target } = req.body;
    if (!text || !target)
      return res.status(400).json({ error: 'Missing text or target language' });

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target }),
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('❌ Translation error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

module.exports = router;
