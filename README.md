# AI VR Scene Maker マニュアル

## 1. 概要

このツールは、Node.js をベースとしたサーバと HTML/JavaScript を用いたクライアントで構成され、ChatGPT API を利用してチャット応答と WebXR コンテンツを生成する AI エージェントです。  
- **プロジェクトごとの管理**: 各プロジェクトごとに独立したチャット履歴と生成された HTML ファイルを管理します。  
- **システムプロンプト**: 固定のシステムプロンプト（内部定数）とユーザが入力したシステムプロンプトを結合して API へ送信します。  
- **固定プロンプト**: 固定プロンプトではA-Frameを利用してWebXR対応のシーンを作成するように指示しています。
- **HTTPS 対応**: 自己署名証明書を利用した HTTPS 接続に対応しています。  

## 2. 必要な環境

- **Node.js**：最新版を推奨  
- **npm**：依存モジュール管理  
- **OpenSSL**：自己署名証明書の生成に利用  
- **ブラウザ**：HTTPS に対応（自己署名証明書の場合、警告が表示される点に注意）
- **API Key**: OpenAIのAPI Keyを取得してください

## 3. 設定方法

### 3.1. ディレクトリ構造例

以下のようなディレクトリ構造でプロジェクトを管理します。

```
/your-project-directory
├── server.js            // サーバサイドのメインコード
├── package.json         // npm の依存関係ファイル
├── .env                 // API キーなどの環境変数を設定するファイル
├── key.pem              // 自己署名証明書の秘密鍵
├── cert.pem             // 自己署名証明書
└── public
		├── index.html       // クライアント側のHTMLファイル
		└── （生成された各プロジェクトのHTMLファイル）
```

### 3.2. 環境変数の設定 (.env)

1. プロジェクトルートに `.env` ファイルを作成し、以下のように記述します.
	 ```env
	 OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
	 PORT=3000
	 ```
2. `OPENAI_API_KEY` は発行された実際の API キーに置き換えてください。

### 3.3. 自己署名証明書の作成

ローカル環境で HTTPS 接続を有効にするため、以下のコマンドで自己署名証明書を生成します.
```bash
openssl req -nodes -new -x509 -keyout key.pem -out cert.pem -days 365
```
- 生成された `key.pem` と `cert.pem` をプロジェクトルートに配置します.

## 4. サーバの実行方法

1. **npm モジュールのインストール**  
	 プロジェクトディレクトリで以下のコマンドを実行します.
	 ```bash
	 npm install
	 ```
2. **サーバの起動**  
	 サーバは `server.js` 内で HTTPS サーバとして設定されています. 以下のコマンドで起動します.
	 ```bash
	 node server.js
	 ```
	 - サーバは `.env` で指定したポート（例：3000）で HTTPS 経由で稼働します.  
	 - ブラウザでアクセスする際、自己署名証明書の場合はセキュリティ警告が表示される場合があります.

## 5. クライアントの使い方

クライアントは `public/index.html` をブラウザで開くことで利用できます. 画面は左右に分割され、以下のように機能します.

### 5.1. 左側パネル（チャットインターフェース）

- **プロジェクト名設定**  
	- 「プロジェクト名」入力欄に任意の名前を入力し、「プロジェクト設定」ボタンをクリックすると、そのプロジェクト専用のチャット履歴と HTML ファイルが利用されます.  
	- プロジェクトごとのチャット履歴はブラウザのローカルストレージに保存されます.

- **履歴クリア**  
	- 「履歴クリア」ボタンをクリックすると、現在のプロジェクトのチャット履歴が削除され、次回送信時は新規に生成されます.

- **システムプロンプト（ユーザ入力）**  
	- 固定システムプロンプトはサーバ側の内部定数として埋め込まれており、画面には表示されません.  
	- ユーザは追加の仕様や注意事項を「システムプロンプト（ユーザ入力）」欄に入力します.  
	- この入力内容は固定システムプロンプトと結合され、全プロジェクト共通で保存されます.

- **チャットメッセージ送信**  
	- 「メッセージ」欄に内容を入力し、「送信」ボタンをクリックすると、メッセージがチャット履歴に追加され、サーバへ送信されます.  
	- 送信後、入力欄は自動的にクリアされ、チャット履歴は最新のメッセージが見えるように自動スクロールされます.

- **プログレスインジケーター**  
	- API の応答を待っている間、点滅する「考え中」の表示が出ます.

### 5.2. 右側パネル（HTML プレビュー）

- 右側には、サーバ側で生成された HTML ファイルが iframe を通じて表示されます.  
- プロジェクト名に応じたファイル（例：`project.html`）が表示され、常に最新の内容が反映されます.

## 6. その他の注意事項

- **HTTPS の利用**  
	- 自己署名証明書を利用しているため、開発・テスト環境向けです. 本番環境では正式な証明書を利用してください.
- **ローカルストレージ**  
	- チャット履歴やシステムプロンプトは、ブラウザのローカルストレージにプロジェクトごとに保存されます. プロジェクト名を変更することでデータを切り替えることが可能です.

