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

// public フォルダは従来通り静的ファイルの提供に利用
app.use(express.static('public'));

// 環境変数からログとHTML保存先のディレクトリを取得
// 指定がなければデフォルトとして、ログは gen/log、HTMLは gen/html を利用
const logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(__dirname, 'gen', 'log');
const htmlDir = process.env.HTML_DIR ? path.resolve(process.env.HTML_DIR) : path.join(__dirname, 'gen', 'html');

// ログ保存用フォルダが存在しなければ再帰的に作成
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 生成HTML保存用フォルダが存在しなければ再帰的に作成
if (!fs.existsSync(htmlDir)) {
  fs.mkdirSync(htmlDir, { recursive: true });
}

// /gen パスで生成HTMLを参照できるように静的ルーティングを追加
app.use('/gen', express.static(htmlDir));

// 固定システムプロンプトはプロジェクトルートから読み込む
const fixedPromptFile = path.join(__dirname, 'fixedSystemPrompt.txt');
// ユーザシステムプロンプトの保存ファイルはログディレクトリ内に保存
const userPromptFile = path.join(logDir, 'userSystemPrompt.txt');

// Node.js の child_process モジュールを利用
const { exec } = require('child_process');

// gen フォルダの絶対パスを取得（__dirname は server.js のあるディレクトリを想定）
const genDir = path.join(__dirname, 'gen');

// ファイルパスを相対パスに変換して、gen 内で git コマンドを実行する関数
function gitCommit(filePath, commitMessage) {
  // filePath は絶対パスの場合、gen からの相対パスに変換
  const relativeFilePath = path.relative(genDir, filePath);
  
  // git add を実行
  exec(`git add ${relativeFilePath}`, { cwd: genDir }, (err, stdout, stderr) => {
    if (err) {
      console.error("git add エラー:", stderr);
      return;
    }
    // git commit を実行（commitMessage 内のシングルクォートなどは必要に応じてサニタイズしてください）
    exec(`git commit -m "${commitMessage}"`, { cwd: genDir }, (err2, stdout2, stderr2) => {
      if (err2) {
        console.error("git commit エラー:", stderr2);
        return;
      }
      console.log("git commit 成功:", stdout2);
    });
  });
}



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
  // 固定プロンプトはプロジェクトルートの fixedSystemPrompt.txt を利用
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
    
    // 固定システムプロンプトはプロジェクトルートのファイルから読み込む（手動更新）
    const savedFixedPrompt = fs.existsSync(fixedPromptFile) ? fs.readFileSync(fixedPromptFile, 'utf8') : "";
    const savedUserPrompt = fs.existsSync(userPromptFile) ? fs.readFileSync(userPromptFile, 'utf8') : "";
    const combinedSystemPrompt = savedFixedPrompt + "\n" + savedUserPrompt;
    
    // チャット履歴ファイル (logDir/プロジェクト名.json)
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
    
    // オプション：最新のHTMLコンテキストを追加（htmlDir/プロジェクト名.html が存在する場合）
    const htmlFilePath = path.join(htmlDir, projectName + '.html');
    if (fs.existsSync(htmlFilePath)) {
      const latestHtml = fs.readFileSync(htmlFilePath, 'utf8');
      if (latestHtml && latestHtml.trim() !== "") {
        messages.push({
          role: 'system',
          content: `最新のHTMLコンテキスト:\n${latestHtml}`
        });
      }
    }
    
    // API に送信するペイロードを作成
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
    console.log(result.chat) 
    // 返ってきたHTMLがあれば、htmlDir/プロジェクト名.html に保存
    if (projectName && result.html && result.html.trim() !== "") {
      fs.writeFileSync(path.join(htmlDir, projectName + '.html'), result.html, 'utf8');
    }
    
    // 更新したチャット履歴をファイルに保存
    fs.writeFileSync(logPath, JSON.stringify(chatHistory, null, 2), 'utf8');
   
    
    // ファイルのコミット（assistant メッセージを commit message として利用）
    if (result.chat && result.chat.trim() !== "") {
      // git commit では改行や特殊文字に注意が必要なので、必要ならサニタイズしてください
      const commitMsg = result.chat.trim().replace(/'/g, ""); // シンプルな例：シングルクォートを削除
      gitCommit(logPath, commitMsg);
      if (fs.existsSync(htmlFilePath)) {
        gitCommit(htmlFilePath, commitMsg);
      }
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



// HTTPS サーバの起動設定
const PORT = process.env.PORT || 3000;
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`サーバはポート ${PORT} でHTTPS接続で稼働中`);
});
