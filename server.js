// server.js
// Node.js + Express を使ったチャット履歴およびシステムプロンプト保存サーバ (HTTPS対応)

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https'); // HTTPS モジュール
const axios = require('axios');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// ログ保存用フォルダ「log」が存在しなければ作成
const logDir = path.join(__dirname, 'log');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// 固定システムプロンプトの保存ファイル（全プロジェクト共通）
// ※このファイルは手動で更新してください
const fixedPromptFile = path.join(logDir, 'fixedSystemPrompt.txt');
// ユーザシステムプロンプトの保存ファイル（全プロジェクト共通）
const userPromptFile = path.join(logDir, 'userSystemPrompt.txt');


// GET /chatHistory?projectName=xxx
app.get('/chatHistory', (req, res) => {
  const projectName = req.query.projectName;
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required' });
  }
  const logPath = path.join(logDir, projectName + '.json');
  if (fs.existsSync(logPath)) {
    try {
      const data = fs.readFileSync(logPath, 'utf8');
      const history = JSON.parse(data);
      res.json(history);
    } catch (e) {
      res.status(500).json({ error: 'Error reading log file' });
    }
  } else {
    res.json([]);
  }
});

// DELETE /chatHistory?projectName=xxx
app.delete('/chatHistory', (req, res) => {
  const projectName = req.query.projectName;
  if (!projectName) {
    return res.status(400).json({ error: 'projectName is required' });
  }
  const logPath = path.join(logDir, projectName + '.json');
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
  res.json({ success: true });
});

// GET /systemPrompt/user
app.get('/systemPrompt/user', (req, res) => {
  if (fs.existsSync(userPromptFile)) {
    try {
      const data = fs.readFileSync(userPromptFile, 'utf8');
      res.json({ userSystemPrompt: data });
    } catch (e) {
      res.status(500).json({ error: 'Error reading user system prompt file' });
    }
  } else {
    res.json({ userSystemPrompt: "" });
  }
});

// GET /systemPrompt/fixed
app.get('/systemPrompt/fixed', (req, res) => {
  if (fs.existsSync(fixedPromptFile)) {
    try {
      const data = fs.readFileSync(fixedPromptFile, 'utf8');
      res.json({ fixedSystemPrompt: data });
    } catch (e) {
      res.status(500).json({ error: 'Error reading fixed system prompt file' });
    }
  } else {
    res.json({ fixedSystemPrompt: "" });
  }
});

// POST /chat
// ユーザからのメッセージを受け取り、ユーザシステムプロンプトの更新・チャット履歴の保存および ChatGPT API を呼び出す
app.post('/chat', async (req, res) => {
  try {
    // クライアントから送信されたデータ（固定プロンプトはクライアントから送らない）
    const { userSystemPrompt, userMessage, projectName } = req.body;
    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    
    // ユーザシステムプロンプトを更新（サーバ側に保存）
    if (typeof userSystemPrompt === 'string') {
      fs.writeFileSync(userPromptFile, userSystemPrompt, 'utf8');
    }
    
    // 固定システムプロンプトはファイルから読み込む（手動更新）
    const savedFixedPrompt = fs.existsSync(fixedPromptFile) ? fs.readFileSync(fixedPromptFile, 'utf8') : "";
    const savedUserPrompt = fs.existsSync(userPromptFile) ? fs.readFileSync(userPromptFile, 'utf8') : "";
    const combinedSystemPrompt = savedFixedPrompt + "\n" + savedUserPrompt;
    
    // チャット履歴ファイル (log/プロジェクト名.json)
    const logPath = path.join(logDir, projectName + '.json');
    let chatHistory = [];
    if (fs.existsSync(logPath)) {
      try {
        const data = fs.readFileSync(logPath, 'utf8');
        chatHistory = JSON.parse(data);
      } catch (e) {
        chatHistory = [];
      }
    }
    
    // 初回の場合、システムプロンプトを最初のメッセージとして追加
    if (chatHistory.length === 0) {
      chatHistory.push({ role: 'system', content: combinedSystemPrompt });
    }
    
    // ユーザのメッセージを履歴に追加
    chatHistory.push({ role: 'user', content: userMessage });
    
    // API 呼び出し用のメッセージ配列（現在の履歴をそのまま利用）
    const messages = chatHistory.slice();
    
    // オプション：最新のHTMLコンテキストを追加（public/プロジェクト名.html が存在する場合）
    const htmlFilePath = path.join(__dirname, 'public', projectName + '.html');
    if (fs.existsSync(htmlFilePath)) {
      const latestHtml = fs.readFileSync(htmlFilePath, 'utf8');
      if (latestHtml && latestHtml.trim() !== "") {
        messages.push({
          role: 'system',
          content: `最新のHTMLコンテキスト:\n${latestHtml}`
        });
      }
    }
    
    // API に送信するペイロード
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
    let result;
    try {
      result = JSON.parse(apiReply);
    } catch (e) {
      result = { html: '', chat: apiReply };
    }
    
    // アシスタントの返信を履歴に追加
    chatHistory.push({ role: 'assistant', content: result.chat });
    
    // 返ってきたHTMLがあれば、public/プロジェクト名.html に保存
    if (projectName && result.html && result.html.trim() !== "") {
      fs.writeFileSync(path.join(__dirname, 'public', projectName + '.html'), result.html, 'utf8');
    }
    
    // 更新したチャット履歴をファイルに保存
    fs.writeFileSync(logPath, JSON.stringify(chatHistory, null, 2), 'utf8');
    
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

// HTTPS サーバの起動設定
const PORT = process.env.PORT || 3000;
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`サーバはポート ${PORT} でHTTPS接続で稼働中`);
});
