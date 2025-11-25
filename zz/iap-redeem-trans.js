// iap-redeem-trans.js (CommonJS)
const express = require('express');
const { google } = require('googleapis');
const { readFileSync } = require('fs');

const router = express.Router();

// 讀取憑證
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(readFileSync('./keys/voice-translator-key.json')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// 初始化 Sheets API
const sheets = google.sheets({ version: 'v4', auth });

// Google Sheet ID
const SPREADSHEET_ID = process.env.SHEET_ID_TRANS; // .env 中設定

// ✅ 1️⃣ 首次登入檢查與贈送 - 新增 email 參數
router.post('/check-signup', async (req, res) => {
  try {
    const { id, email, coins } = req.body; // 新增 email
    if (!id) return res.status(400).json({ error: 'Missing user id' });
    if (!coins) return res.status(400).json({ error: 'Missing coins amount' });

    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F', // 擴展到 F 欄
    });

    const rows = sheet.data.values || [];
    const alreadySignedUp = rows.some(row => row[0] === id && row[1] === 'signup_bonus');

    if (alreadySignedUp) {
      return res.json({ bonusGiven: false, message: 'User already received signup bonus.' });
    }

    const timestamp = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F', // 擴展到 F 欄
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, 'signup_bonus', coins, timestamp, 'auto-login-bonus', email || '']], // 新增 email
      },
    });

    res.json({ bonusGiven: true, coins: coins });
  } catch (err) {
    console.error('❌ check-signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ 2️⃣ 儲值紀錄 - 新增 email 參數
router.post('/topup', async (req, res) => {
  try {
    const { id, email, coins, note = 'iap-topup' } = req.body; // 新增 email
    if (!id || !coins) return res.status(400).json({ error: 'Missing parameters' });

    const timestamp = new Date().toISOString();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F', // 擴展到 F 欄
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[id, 'topup', coins, timestamp, note, email || '']], // 新增 email
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ topup error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ 3️⃣ 特殊金額檢查 - 新增 email 參數
router.post('/check-special-balance', async (req, res) => {
  try {
    const { name, id, email } = req.body; // 新增 email
    
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:F', // 擴展到 F 欄
    });

    const rows = sheet.data.values || [];
    
    // 尋找對應的特殊設定 - 同時檢查 email
    const specialRecordIndex = rows.findIndex(row => 
      (row[0] === name || row[0] === id || row[5] === email) && // 檢查 F 欄的 email
      row[1] === 'set_balance'
    );

    if (specialRecordIndex !== -1) {
      const specialRecord = rows[specialRecordIndex];
      const coins = parseInt(specialRecord[2]);
      
      const executedTime = new Date().toISOString();

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!B${specialRecordIndex + 1}:D${specialRecordIndex + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['set_balance_executed', rows[specialRecordIndex][2], executedTime]],
        },
      });

      res.json({ 
        hasSpecialBalance: true, 
        coins: coins 
      });
    } else {
      res.json({ hasSpecialBalance: false });
    }
  } catch (err) {
    console.error('❌ check-special-balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;