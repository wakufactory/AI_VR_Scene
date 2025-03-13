// server.js
// Node.js + Express を使った HTTPS サーバ（自己署名証明書利用）

// dotenvパッケージで環境変数をロード
require('dotenv').config();

// 必要なモジュールの読み込み
const express = require('express');         // Webサーバ用フレームワーク
const fs = require('fs');                   // ファイル操作用モジュール
const path = require('path');               // パス操作用モジュール
const axios = require('axios');             // HTTPリクエスト用ライブラリ
const bodyParser = require('body-parser');  // リクエストボディのパース用
const https = require('https');             // HTTPSサーバ用モジュール

// Expressアプリの初期化
const app = express();

// JSON形式のリクエストボディを扱うためのミドルウェア設定
app.use(bodyParser.json());
// publicフォルダ内の静的ファイルを提供
app.use(express.static('public'));

// ルートエンドポイント： index.html を返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 以下はこれまでの /chat エンドポイントの実装（省略可能）
// ※必要なコードはそのまま残してください。

// チャット機能用エンドポイント
app.post('/chat', async (req, res) => {
  try {
    const { systemPrompt, chatHistory, userMessage, projectName } = req.body;
    const addMessageIfContent = (message) => {
      if (message.content && message.content.trim() !== "") {
        return message;
      }
      return null;
    };
    const messages = [];
    const sysMsg = addMessageIfContent({ role: 'system', content: systemPrompt });
    if (sysMsg) messages.push(sysMsg);
    if (projectName && Array.isArray(chatHistory) && chatHistory.length > 1) {
      const htmlFilePath = path.join(__dirname, 'public', `${projectName}.html`);
      if (fs.existsSync(htmlFilePath)) {
        const latestHtml = fs.readFileSync(htmlFilePath, 'utf8');
        if (latestHtml && latestHtml.trim() !== "") {
          messages.push({
            role: 'system',
            content: `最新のHTMLコンテキスト:\n${latestHtml}`
          });
        }
      }
    }
    if (Array.isArray(chatHistory)) {
      chatHistory.forEach(msg => {
        const filteredMsg = addMessageIfContent(msg);
        if (filteredMsg) messages.push(filteredMsg);
      });
    }
    const shouldAddUserMessage = 
      !(
        Array.isArray(chatHistory) &&
        chatHistory.length > 0 &&
        chatHistory[chatHistory.length - 1].role === 'user' &&
        chatHistory[chatHistory.length - 1].content.trim() === userMessage.trim()
      );
    if (shouldAddUserMessage && userMessage.trim() !== "") {
      messages.push({ role: 'user', content: userMessage });
    }
    const payload = {
      model: 'o3-mini',
      messages: messages,
      reasoning_effort: 'high'
    };
    console.log("Sending API request with payload:", payload);
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      }
    );
    console.log("API response data:", response.data);
    const apiReply = response.data.choices[0].message.content;
    let result = {};
    try {
      result = JSON.parse(apiReply);
    } catch (e) {
      result = { html: '', chat: apiReply };
    }
    if (projectName && result.html && result.html.trim() !== "") {
      fs.writeFileSync(
        path.join(__dirname, 'public', `${projectName}.html`),
        result.html
      );
    }
    res.json(result);
  } catch (error) {
    if (error.response) {
      console.error(
        'APIリクエストが失敗しました。ステータス:',
        error.response.status,
        'レスポンスデータ:',
        error.response.data
      );
    } else {
      console.error('APIリクエスト中にエラーが発生しました:', error);
    }
    res.status(500).json({ error: 'サーバエラーが発生しました。' });
  }
});

// HTTPSサーバの起動設定
const PORT = process.env.PORT || 3000;
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`サーバはポート ${PORT} でHTTPS接続で稼働中`);
});
