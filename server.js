// server.js
// Node.js + Express を使ったチャット履歴およびシステムプロンプト保存サーバ（HTTPS対応・git自動コミット付き）
// .env の GIT_AUTO_COMMIT が "true" の場合のみ、自動コミットを実行します。

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https'); // HTTPS モジュール
const axios = require('axios');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const util = require('util');
require('dotenv').config();

// Promise 化した exec
const execAsync = util.promisify(exec);

const app = express();
app.use(bodyParser.json());

// public フォルダは従来通り静的ファイルの提供に利用
app.use(express.static('public'));

// 環境変数からログとHTML保存先のディレクトリを取得
// 指定がなければデフォルトとして、ログは gen/log、HTML は gen/html を利用
const logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(__dirname, 'gen', 'log');
const htmlDir = process.env.HTML_DIR ? path.resolve(process.env.HTML_DIR) : path.join(__dirname, 'gen', 'html');

// OpenAI API 設定（.env から読み込み、指定がなければデフォルト値を利用）
const openAiModel = process.env.OPENAI_MODEL || 'o3-mini';
const reasoningEffort = process.env.REASONING_EFFORT || 'high';

// 必要なディレクトリが存在しなければ再帰的に作成
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
if (!fs.existsSync(htmlDir)) {
  fs.mkdirSync(htmlDir, { recursive: true });
}

// /gen パスで生成HTMLを参照できるように静的ルーティングを追加
app.use('/gen', express.static(htmlDir));

// 固定システムプロンプトはプロジェクトルートの fixedSystemPrompt.txt から読み込む
const fixedPromptFile = path.join(__dirname, 'fixedSystemPrompt.txt');
// テンプレートファイルはプロジェクトルートの template.html から読み込む
const templateFile = path.join(__dirname, 'template.html');
// ユーザシステムプロンプトはログディレクトリ内に保存（gen/log/userSystemPrompt.txt）
const userPromptFile = path.join(logDir, 'userSystemPrompt.txt');

//
// GET /chatHistory?projectName=xxx
//
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

//
// DELETE /chatHistory?projectName=xxx
//
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

//
// GET /systemPrompt/user
//
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

//
// GET /systemPrompt/fixed
//
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

//
// POST /chat
// ユーザメッセージ受信、プロンプト更新、チャット履歴保存、ChatGPT API 呼び出し、HTML生成、git 自動コミット＋プロジェクト名をコミットメッセージ先頭に追加
//
app.post('/chat', async (req, res) => {
  try {
    // クライアントから送信されたデータ
    const { userSystemPrompt, userMessage, projectName } = req.body;
    if (!projectName) {
      return res.status(400).json({ error: 'projectName is required' });
    }
    
    // ユーザシステムプロンプトを更新（サーバ側に保存）
    if (typeof userSystemPrompt === 'string') {
      fs.writeFileSync(userPromptFile, userSystemPrompt, 'utf8');
    }
    
    // 固定システムプロンプトはプロジェクトルートの fixedSystemPrompt.txt から読み込む
    const savedFixedPrompt = fs.existsSync(fixedPromptFile) ? fs.readFileSync(fixedPromptFile, 'utf8') : "";
    const savedUserPrompt = fs.existsSync(userPromptFile) ? fs.readFileSync(userPromptFile, 'utf8') : "";
    const combinedSystemPrompt = savedFixedPrompt + "\n" + savedUserPrompt;
    
    // チャット履歴ファイル (gen/log/プロジェクト名.json)
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
    } else if(fs.existsSync(templateFile)){ // テンプレートtemplate.htmlがあれば最初のコンテキストとする
      const latestHtml = fs.readFileSync(templateFile, 'utf8') 
      if (latestHtml && latestHtml.trim() !== "") {
        messages.push({
          role: 'system',
          content: `最初のHTMLコンテキスト:\n${latestHtml}`
        });
      }
    }
    
    // API に送信するペイロードの作成
    const payload = {
      model: openAiModel,
      messages: messages,
      reasoning_effort: reasoningEffort,
      response_format: { type: 'json_object' }  // 戻り値を JSON オブジェクトとして指定
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
      result = { html: '', chat: "response error" };
    }
    
    // アシスタントの返信をチャット履歴に追加
    chatHistory.push({ role: 'assistant', content: result.chat });
    
    // 返ってきたHTMLがあれば、gen/html/プロジェクト名.html に保存
    if (projectName && result.html && result.html.trim() !== "") {
      fs.writeFileSync(path.join(htmlDir, projectName + '.html'), result.html, 'utf8');
    }
    
    // 更新したチャット履歴をファイルに保存
    fs.writeFileSync(logPath, JSON.stringify(chatHistory, null, 2), 'utf8');
    
    // .env の GIT_AUTO_COMMIT が "true" の場合のみ、自動コミットを実行
    if (process.env.GIT_AUTO_COMMIT === "true") {
      await commitFilesTogether(logPath, path.join(htmlDir, projectName + '.html'), result.chat);
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

// GET /api/list
// gen/html 内の HTML ファイル一覧と、各ファイルに対応する gen/log/[プロジェクト名].json の最初の user メッセージ、最終更新日を JSON 形式で返す
app.get('/api/list', (req, res) => {
  fs.readdir(htmlDir, (err, files) => {
    if (err) {
      console.error("HTML ディレクトリの読み込みエラー:", err);
      return res.status(500).json({ error: "Error reading html directory." });
    }
    // .html ファイルのみ（list.html は除く）
    files = files.filter(file => file.endsWith('.html') && file !== 'list.html');
    let listData = [];
    files.forEach(file => {
      // プロジェクト名はファイル名から拡張子を除いたもの
      const projectName = file.slice(0, -5);
      const logFile = path.join(logDir, projectName + '.json');
      let description = "";
      if (fs.existsSync(logFile)) {
        try {
          const data = fs.readFileSync(logFile, 'utf8');
          const logData = JSON.parse(data);
          // 最初の user メッセージを取得
          const firstUser = logData.find(msg => msg.role === 'user');
          if (firstUser) {
            description = firstUser.content;
          }
        } catch(e) {
          description = "";
        }
      }
      // 最終更新日は、html ファイルの最終修正日時から取得
      let lastModified = "";
      try {
        const stats = fs.statSync(path.join(htmlDir, file));
        lastModified = stats.mtime.toISOString();
      } catch(e) {
        lastModified = "";
      }
      listData.push({
        filename: file,
        projectName: projectName,
        description: description,
        lastModified: lastModified
      });
    });
    res.json(listData);
  });
});


//
// commitFilesTogether 関数：ログファイルと HTML ファイルの両方を add してから、まとめて commit する。
// コミットメッセージの1行目にプロジェクト名を追加します。
//
const genDir = path.join(__dirname, 'gen');
async function commitFilesTogether(logFilePath, htmlFilePath, assistantMessage) {
  // ログファイル名からプロジェクト名を抽出（例: gen/log/[projectName].json -> projectName）
  const projectName = path.basename(logFilePath, '.json');
  // シンプルなサニタイズ例：シングルクォートを削除
  const sanitizedMessage = assistantMessage.trim().replace(/'/g, "");
  // コミットメッセージの先頭行にプロジェクト名を追加
  const commitMsg = `${projectName}: ${sanitizedMessage}`;
  
  // 対象ファイルが存在するかチェックし、gen 配下からの相対パスを取得
  let filesToCommit = [];
  
  if (fs.existsSync(logFilePath)) {
    filesToCommit.push(path.relative(genDir, logFilePath));
  }
  if (fs.existsSync(htmlFilePath)) {
    filesToCommit.push(path.relative(genDir, htmlFilePath));
  }
  
  if (filesToCommit.length === 0) {
    console.log("コミット対象ファイルはありません。");
    return;
  }
  
  try {
    // 両方のファイルを add する
    await execAsync(`git add ${filesToCommit.join(" ")}`, { cwd: genDir });
    // まとめて commit する
    await execAsync(`git commit -m "${commitMsg}"`, { cwd: genDir });
    console.log(`git commit 成功: ${filesToCommit.join(", ")}`);
  } catch (error) {
    console.error(`git commit エラー (${filesToCommit.join(", ")}):`, error.stderr || error);
  }
}

// HTTPS サーバの起動設定
const PORT = process.env.PORT || 3000;
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`サーバはポート ${PORT} でHTTPS接続で稼働中`);
});
