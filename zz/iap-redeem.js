const express = require('express');
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();
const GAS_BASE_URL = process.env.GAS_URL;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID; // Add this to your environment variables

// Initialize OAuth2Client
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyIdToken(idToken) {
  if (!idToken) {
    throw new Error('No ID token provided');
  }

  
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID, // Required for audience validation
  });
  const payload = ticket.getPayload();
  return payload;
}


// 處理 doGet
router.get('/', async (req, res) => {
  try {
    const { id } = req.query; // 從id獲取查詢結果
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "缺少 id"
      });
    }

    const response = await axios.get(`${GAS_BASE_URL}?id=${id}`, {
      headers: {
        'Accept': 'application/json',
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('[GET] 金幣查詢失敗:', error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || '金幣查詢服務異常'
    });
  }
});


// 處理 doPost
router.post('/', async (req, res) => {
  const { idToken, ...rest } = req.body;
  console.log(idToken);
// Add validation for idToken
  if (!idToken) {
    return res.status(400).json({ 
      success: false, 
      message: '缺少 ID token' 
    });
  }

  try {
    const payload = await verifyIdToken(idToken);
    const userId = payload.sub;
    
    // Verify ID match
    if (userId !== rest.id) {
      return res.status(401).json({ 
        success: false, 
        message: 'ID 不一致，驗證失敗' 
      });
    }

    const response = await axios.post(GAS_BASE_URL, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });

    res.json(response.data);
  } catch (error) {
    console.error('金幣紀錄轉發失敗:', {
      error: error.message,
      stack: error.stack,
      receivedBody: req.body // Be careful with logging sensitive data
    });
    res.status(500).json({
      success: false,
      message: error.message || '內部錯誤',
    });
  }
});

module.exports = router;
