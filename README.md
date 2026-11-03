# desktop_ai

デスクトップに常駐する会話AIです。好きなキャラクター（Live2D または 3D）が画面の隅にいて、文字でも声でも話しかけられます。
会話・音声認識・読み上げはすべてローカルで動くので、クラウドの API キーや利用料は要りません。

- 会話: [Ollama](https://ollama.com/)（既定は `qwen3:8b`）
- 表示: Electron + Live2D（Cubism 3/4）／ 3D（glTF・GLB・VRM、three.js）
- 読み上げ: [VOICEVOX](https://voicevox.hiroshiba.jp/)
- 音声認識: Whisper（[transformers.js](https://github.com/huggingface/transformers.js)、`whisper-large-v3-turbo`）

## できること

- 吹き出しでの会話（返事の気持ちに合わせて表情や動きが変わる）
- 声での会話（マイク → 文字起こし → 返事を読み上げ、口パク）
- 「YouTube 開いて」「GitHub で electron を検索して」などでサイトを開く
- 「明日の天気は？」で天気予報を答える
- 好きなモデルの読み込み（Live2D・3D）とキャラの切り替え
- 3D モデルはボーンを自動で見つけて、視線・呼吸・手を振る・立ち姿・足の組み替えなどを付ける

## 必要なもの

- Windows 10 / 11
- [Node.js](https://nodejs.org/) LTS
- [Ollama](https://ollama.com/) と会話用モデル
- [VOICEVOX](https://voicevox.hiroshiba.jp/)（声で話させたいときだけ。一度起動しておけば、以降はアプリが裏でエンジンを起動します）
- 会話用モデルを快適に動かすには、VRAM 8GB 以上の GPU があると安心です

```bash
ollama pull qwen3:8b
```

## インストール

```bash
git clone https://github.com/mkosei/desktop_ai.git
```
```bash
cd desktop_ai
```
```bash
npm install
```

`npm install` のあと `node_modules\electron\dist\electron.exe` が無い場合は、npm がインストールスクリプトを止めています。
npm の表示に従って Electron のスクリプトを許可し、入れ直してください。

```bash
npm install-scripts approve electron
```
```bash
npm rebuild electron
```

## 起動

`start.bat` をダブルクリックするか、次のコマンドで起動します。

```bash
npm start
```

初めて声で話しかけたときは、音声認識モデル（約 1GB）のダウンロードがあるので少し時間がかかります。

## 使い方

| 操作 | 内容 |
|---|---|
| キャラを左クリック | 入力欄を出す／しまう（反応して動く） |
| キャラをドラッグ | 好きな場所へ移動 |
| キャラを右クリック | メニュー（下の表） |
| `Ctrl+Space` | 1 回だけ声を聞いて返事をする（聞いている途中にもう一度押すと取り消し） |
| `Ctrl+Alt+V` / マイクボタン | 音声会話モードの ON/OFF（話し終わるたびに自動でまた聞く） |

右クリックメニュー：

| 項目 | 内容 |
|---|---|
| キャラ切り替え | 登録してあるキャラを切り替える |
| 立ち姿 / 足 | 3D キャラのポーズ（手を後ろで組む・自然体・腰に手・足を組む・おまかせ） |
| 音声会話 ON/OFF | `Ctrl+Alt+V` と同じ |
| 会話をリセット | 会話の履歴を消す |
| 常に最前面 | ほかのウィンドウより前に出しておくか |
| モデルを読み込む… | 好きなモデルを追加する（下で説明） |
| キャラ設定を開く | `config.local.json` を開く |
| 設定を再読み込み | 設定ファイルの変更を反映する |

話しかけ方の例：

- 「YouTube 開いて」「ユーチューブで猫の動画探して」「X ひらいて」
- 「今日の天気は？」「明日千葉って雨降る？」

## モデルを読み込む

右クリック →「モデルを読み込む…」で、次のファイルを選びます。

| 種類 | 選ぶファイル | 備考 |
|---|---|---|
| Live2D | `*.model3.json` | Cubism 3/4 形式。同じフォルダの中身ごとコピーされます |
| 3D | `*.vrm` / `*.glb` | 1 ファイルのままコピーされます |
| 3D | `*.gltf` | テクスチャなどを参照するので、フォルダごとコピーされます |

選んだモデルは `models/<名前>/` にコピーされ、キャラとして追加されて、そのキャラに切り替わります。

自動でやってくれること：

- **Live2D**：表情の名前（Smile・Angry・Sad など）とタップ用モーション（Tap など）を名前から探して、感情や反応に割り当てます
- **3D**：首・頭・目・胸・腕・手・指・脚のボーンを名前から探します（VRM・Mixamo・3ds Max Biped・Unity・Blender などの名前に対応）。
  ボーンが見つかれば、視線・呼吸・手を振る・うなずく・立ち姿・足を組むなどが動きます。
  ボーンの無いモデルは、全体を揺らしたり跳ねさせたりする簡単な動きになります
- **VRM 0.x**：後ろ向きのモデルはこちらを向くように回します

### 読み込んだキャラを調整する

右クリック →「キャラ設定を開く」で `config.local.json` を開き、`characters` の中の項目を書き換えて「設定を再読み込み」します。

| 項目 | 内容 |
|---|---|
| `characterName` | 名前（吹き出しに出る） |
| `persona` | 性格・話し方（AI への指示文） |
| `modelScale` | Live2D の大きさ |
| `expressions` | 感情タグ（normal / smile / angry / sad / surprised / shy）→ 表情。Live2D は表情名、または `{ "パラメータID": 値 }` |
| `tapMotions` | Live2D で頭・体をクリックしたときのモーショングループ |
| `theme` | UI の配色（例：`{ "accent": "#c8435a", "panel": "rgba(28,27,45,0.92)" }`） |
| `voice` | 声の設定（`{ "enabled": false }` で声なし、`speaker` で VOICEVOX の話者 ID） |
| `model3d.fill` | 3D キャラが画面の高さのどれくらいを占めるか（0.8 = 8 割） |
| `model3d.rotationY` | 3D キャラの向き（ラジアン。後ろを向いてしまうときは `3.14159`） |
| `model3d.hideMeshes` | 消したい部品の名前（マテリアル名かメッシュ名の一部）。武器などを消すときに |
| `model3d.motionScale` / `motionSpeed` | 動きの大きさ・速さ |
| `model3d.fingerCurl` | 指の曲げ具合（0 でまっすぐ） |

## 設定ファイル

- `config.json`：共通の設定（会話モデル、ホットキー、開けるサイト、天気の地域、音声認識など）
- `config.local.json`：この PC だけの設定（読み込んだキャラ、選択中のキャラ）。`config.json` より優先されます

`config.json` の主な項目：

| 項目 | 内容 |
|---|---|
| `ollamaModel` | 会話に使う Ollama のモデル（例：`qwen3:14b`） |
| `hotkeys` | `listenOnce`（1 回だけ聞く）と `voiceChat`（音声会話 ON/OFF）のキー |
| `apps` | 開けるサイト・アプリ。`open` に URL かパス、`search` に `{query}` 入りの検索 URL |
| `weather.places` | 天気を調べる地域（地名と緯度・経度） |
| `voice` | VOICEVOX の URL・話者 ID・話速など |
| `stt` | 音声認識のモデル・デバイス・精度 |

## 注意

- モデルは、それぞれの配布元のライセンス・利用規約に従って使ってください。配布や公開が禁止されているモデルも多いので、`models/` を公開リポジトリに含めないよう気をつけてください
- VOICEVOX で作った音声を公開するときは、各キャラクターの規約に従ってクレジット（例：「VOICEVOX:ずんだもん」）を表記してください

## ライセンス

[MIT](LICENSE)
