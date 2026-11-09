# ClavierDesk MCP開発 引継ぎ資料

> 再開入口（2026-11-09）：[譜面新規構築MVPの要件・設計方針・引継ぎ](./score-authoring-mvp-handoff.md)を最初に読むこと。現在の目標は、空のプロジェクトからまとまった譜面を記述してGUIで確認すること。下記本文は接続MVP当時の記録。

> 更新：この資料の本文は接続MVP時点の記録です。その後、チェックアウト・状態取得・運指編集を追加しました。現行仕様は[チェックアウトとUI入力](./checkout-and-ui.md)と[MCP README](../../../code/apps/mcp/README.md)を優先してください。現在、編集は作業用データに蓄積し、正常終了時に一括反映してロック解除した後で通知します。

更新日：2026-11-06（日本時間）

## 1. 現在地と再開時に読むもの

**セッション公開・検出・疎通確認のMVPを実装済み。Windowsの実GUIで、Ctrl＋Mによる公開ON→stdio MCP経由の検出・WebView往復→公開OFF後の一覧除外・旧ID拒否を確認した。**

譜面データ・操作状態の参照と編集操作は、ユーザーの指示により次段階で設計する。現MVPには追加していない。MCP世代管理も導入していない。

再開時は、この資料、[MCPの利用手順](../../../code/apps/mcp/README.md)、[Editorの起動手順](../../../code/apps/editor/README.md)、[既存アーキテクチャ](../score-domain-model/architecture.md)の順に読むとよい。

## 2. ユーザーの目的・要件

### 最終的な利用場面

- Codexなどに楽譜の画像・PDFを見せ、ClavierDeskへ入力してもらう。
- 特定小節や指定範囲に推奨の指番号を設定してもらう。
- アプリ上の譜面を共有し、アナリーゼや作曲について会話する。
- 複数のClavierDeskを同時起動し、1つのエージェントからセッションを明示して操作する。
- ドラフト用のセッションにエージェントが案を作成し、ユーザーが表示・試聴しながら、参考にする内容を正書用の別セッションへ手で取り込む。

### 維持する要件

| 項目 | ユーザーの要件 |
| --- | --- |
| 状態の取得元 | 保存済みファイルではなく、画面で編集中の未保存データを扱う。 |
| 操作状態 | カーソル・選択範囲などをMCP経由で把握できるようにする。 |
| 編集能力 | アプリが表現できる譜面編集を網羅する。採譜や運指だけに限定しない。 |
| 操作経路 | エージェントの譜面参照・編集にComputer Useを必要としない。 |
| 公開操作 | GUIのCtrl＋Mで、そのセッションの公開ON/OFFを切り替える。 |
| 接続 | Rust製のstdio MCPサーバーが、公開されたローカルセッションを検出する。 |
| 対象識別 | ユーザーが画面上でIDを見分け、対象セッションを指定できる。Scorehack相当で十分。 |
| 開発段階 | 仕様変更が多いため、現時点ではMCP世代管理を行わない。 |

ドラフトの自動承認・正書セッションへの自動転送・専用の提案承認UIは、今回合意した要件ではない。上記の手動取り込みという利用例から、これらを必須仕様として追加しない。

### 今回のMVPに絞った範囲

ユーザーは、まず「MCPアプリを作り、GUI側でセッション公開→エージェントで認識・疎通確認」までを依頼した。譜面・操作状態の取得と編集のツール名・スキーマ・振る舞いは未設計である。

## 3. 実現方針と実装構成

ScorehackのローカルMCP実装を参照し、接続部分をClavierDeskへ移植した。編集ロジックをRust側へ移してはいない。

```text
Codex / その他のローカルエージェント
    ↕ stdio MCP（JSON-RPC）
code/apps/mcp : clavierdesk-mcp（Rust）
    ↕ 認証付きIPv4ループバックHTTP
code/apps/editor/src-tauri/src/mcp : Tauriブリッジ
    ↕ mainウィンドウ向けイベント / 応答コマンド
code/apps/editor/src/service/mcp : WebView側ハンドラー
```

`clavierdesk-mcp`はMCPクライアントから起動される**MCPサーバー**であり、GUIとは独立したプロセス。GUIが閉じていても起動でき、ツール一覧は固定である。ローカルHTTPはMCPクライアントへ直接登録する接続先ではなく、MCPサーバーとTauri間の内部通信に使う。

現実装の単位は「1つのClavierDeskプロセスのmainウィンドウに対して公開セッションを1つ」。複数プロセスは別々のUUID・動的ポートを使う。単一プロセス内の複数ドキュメント・複数編集ウィンドウは今回設計していない。

### 主なファイルと責務

| ファイル・ディレクトリ | 責務 |
| --- | --- |
| [code/apps/mcp/src/main.rs](../../../code/apps/mcp/src/main.rs) | stdio MCPの起動。stdoutはJSON-RPC専用。 |
| [code/apps/mcp/src/server.rs](../../../code/apps/mcp/src/server.rs) | MCPツールの固定一覧、引数スキーマ、説明、応答。 |
| [code/apps/mcp/src/bridge.rs](../../../code/apps/mcp/src/bridge.rs) | 記述子の探索・検証、認証付き生存確認、指定セッションへの転送。 |
| [code/apps/mcp/smoke.mjs](../../../code/apps/mcp/smoke.mjs) | 実際のstdio MCPプロセスを起動する接続確認スクリプト。 |
| [src-tauri/src/mcp/session.rs](../../../code/apps/editor/src-tauri/src/mcp/session.rs) | 公開開始・停止、UUID・トークン・ポート・記述子、GUI内部の疎通確認。 |
| [src-tauri/src/mcp/server.rs](../../../code/apps/editor/src-tauri/src/mcp/server.rs) | 内部HTTPの受信・認証、main WebViewへの要求転送、タイムアウト。 |
| [src-tauri/src/mcp/bridge.rs](../../../code/apps/editor/src-tauri/src/mcp/bridge.rs) | 要求IDと応答待ちの対応付け、`mcp_respond`。 |
| [src-tauri/src/lib.rs](../../../code/apps/editor/src-tauri/src/lib.rs) | Tauri状態・コマンドの登録。終了・再起動時に公開停止。 |
| [service/mcp/mcp-session-controller.ts](../../../code/apps/editor/src/service/mcp/mcp-session-controller.ts) | 公開状態、開始前のイベント購読、ping応答、失敗時の公開解除、破棄処理。外部APIをPortとして注入。 |
| [infra/tauri/mcp.ts](../../../code/apps/editor/src/infra/tauri/mcp.ts) | PortのTauri実装。invokeとイベント購読。 |
| [components/McpBadge.svelte](../../../code/apps/editor/src/components/McpBadge.svelte) | 状態と完全なUUIDの表示。IDは読み取り専用inputで選択・コピー可能。 |
| [App.svelte](../../../code/apps/editor/src/App.svelte) | Ctrl＋M、サービスの初期化・破棄、ヘッダー表示の組み立て。 |
| [tests/mcp-session.test.mjs](../../../code/apps/editor/tests/mcp-session.test.mjs) | WebView側の公開ライフサイクルのテスト。 |

`code/apps/mcp`は独立したCargoプロジェクト。エディターのCargoプロジェクトとは別に`Cargo.lock`を管理する。pnpmの`build:desktop`ではMCP実行ファイルはビルドされない。

### 公開のライフサイクル

1. WebView初期化時に既存ブリッジを停止する。WebViewの再読み込みで残った公開も解除し、初期表示を非公開にする。
2. Ctrl＋Mで開始する際、古いブリッジを停止し、WebView側の要求イベント購読を準備する。
3. Tauriが`127.0.0.1:0`でポートを取得し、セッションUUID・トークン・記述子・HTTPリスナーを作る。
4. TauriからWebViewまで`ping`を往復させ、成功した後に`MCP ON`と完全なセッションIDを表示する。
5. 再度Ctrl＋Mを押すと公開を停止する。応答待ちを解除し、リスナーを停止し、記述子を削除する。

開始・停止の実行中は追加トグルを無視し、キーリピートでも重複開始しない。開始・内部疎通に失敗した場合は公開解除を試み、`MCP ERROR`を表示する。エラー詳細は表示のホバーで確認でき、Ctrl＋Mで再試行できる。

Ctrl＋Mはモーダル・テキスト入力・再生中の早期returnより前に処理している。デスクトップ版のみ公開でき、ブラウザー版で押した場合は利用不可のダイアログを表示する。

## 4. 現在のツールと通信契約

### MCPツール

各ツールはMCPのtext contentにJSONを返す。以下はそのJSONの内容。

| ツール | 引数 | 応答の内容 |
| --- | --- | --- |
| `ping` | なし | `{ "application": "ClavierDesk", "status": "ok", "appRequired": false }` |
| `list_clavierdesk_sessions` | なし | `{ "sessions": [{ "sessionId": "…", "pid": 123, "createdAtEpochMs": 1234567890 }] }` |
| `probe_session` | `{ "sessionId": "完全なUUID" }` | `{ "sessionId": "…", "gui": { "application": "ClavierDesk", "status": "ok" } }` |

`ping`成功はMCPプロセス単体の確認であり、GUI疎通の証明にはならない。`list_clavierdesk_sessions`はTauri側の認証付き`/health`を確認する。`probe_session`はWebViewまで往復する。

一覧は公開開始時刻の新しい順。不正・到達不能な記述子は一覧に含めない。空配列だけでは、未起動・非公開・到達不能の原因までは区別できない。トークンやHTTP接続先はMCPの一覧応答に出さない。

対象セッションを暗黙に選択する機能はない。画面と一覧で完全なIDを照合し、`probe_session`へ渡す。公開し直すとIDは変わる。資料中の値や前環境のIDを再利用しない。

### セッション記述子

アプリIDは`com.clavierdesk.editor`。Tauriの`app_local_data_dir()/mcp/sessions/<sessionId>.json`へ保存する。Windowsでは次の場所。

```text
%LOCALAPPDATA%/com.clavierdesk.editor/mcp/sessions/<sessionId>.json
```

形式は以下。`token`は64桁の16進文字列で、内部通信専用。

```json
{
  "sessionId": "<UUID>",
  "pid": 123,
  "endpoint": "http://127.0.0.1:<dynamic-port>",
  "token": "<private-token>",
  "createdAtEpochMs": 1234567890
}
```

Scorehackにあった譜面名・dirty状態は今回のMVPに含めていない。記述子・トークン・ポート番号は各環境で生成する実行時データであり、別環境へ引き継ぐファイルではない。

### 内部HTTPとWebView

- `GET /health`：`Authorization: Bearer <token>`が必要。`{ "ok": true, "sessionId": "…" }`を返す。
- `POST /bridge`：同じ認証が必要。要求は`{ "method": "ping", "params": {} }`。
- ブリッジは要求IDを付け、`clavierdesk://mcp/request`を`main`へemitする。
- WebViewが`mcp_respond`で要求ID付きの`result`または`error`を返す。
- HTTP応答は`{ "ok": true, "result": { … }, "error": null }`、または`ok: false`とエラーを返す。
- WebViewが扱うメソッドは現在`ping`のみ。他は`UNKNOWN_METHOD`。

MCPサーバーはUUID形式・ファイル名・トークン形式・IPv4ループバック接続先・生存確認のID一致を検証する。停止済みや不正なIDへのMCP要求は`isError: true`のtext contentで`SESSION_NOT_AVAILABLE`などを返す。WebView由来のエラーは、現MCPアダプターでは一部`BRIDGE_ERROR`へまとめられる。次段階の詳細な編集エラー仕様はまだない。

現実装の制限値は、HTTP要求ヘッダー16 KiB、本文64 KiB、MCPサーバーが受信するHTTP応答全体256 KiB、WebView応答待ち5秒。Tauri側のHTTP接続処理は直列。譜面の範囲取得・一括編集を設計する際は、この制限と処理方式も検討対象になる。

## 5. 別環境への持ち出しと起動

### ソースの状態

この資料作成時のHEADは`1fe2d28`（`save`）。**MCPの実装はその後の未コミット変更・未追跡ファイルとして作業ツリーにある。HEADだけを移してもMCPは含まれない。**

`git status --short --untracked-files=all`で確認し、MCP関連の追加ファイル、Cargoのlockファイル、既存ファイルへの変更、この資料を含めて移す。コミットする場合はその後の実コミットを引継ぎ基準にする。この作業ではコミット・push・エージェントの個人設定への自動登録は行っていない。

MCP作業開始前から次の2ファイルに別件の未コミット変更があり、MCP開発では変更していない。移行時に破棄したり、MCP差分と誤認して戻したりしない。

- `code/apps/editor/src/components/PlaybackPosition.svelte`
- `code/apps/editor/src/infra/notation/preview-selection.ts`

`node_modules`、`dist`、各`target`、`src-tauri/gen`、`temp`は生成物・ローカル検証用でGit管理対象外。別環境では依存関係から再生成する。特に未追跡のMCPソースを移す前に`git clean`しない。

### 必要な環境

- Node.js 24系、pnpm 11.25.0。
- Rust/Cargo。MCPのCargo.tomlは`rust-version = "1.88"`。今回の検証はRust/Cargo 1.93.1、Node.js 24.13.1。
- WindowsのMicrosoft C++ Build ToolsとWebView2。詳細は[Editor README](../../../code/apps/editor/README.md)。
- GUIとMCPプロセスが同じユーザーのアプリデータ領域へアクセスし、ローカルTCP通信ができること。

接続はローカル環境を前提とする。クラウド側だけで動くエージェントからの接続や遠隔公開は今回の対象ではない。OS分岐はあるが、macOS/Linuxの実機検証は未実施。

### インストール・検査・ビルド

以下はリポジトリ直下からPowerShellで実行する。Rustの依存取得が済んでいる環境では、必要に応じてCargoへ`--offline`を付けられる。

```powershell
Set-Location code
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build:desktop

Set-Location apps/editor
node --experimental-transform-types --test tests/mcp-session.test.mjs

Set-Location src-tauri
cargo test
cargo fmt -- --check

Set-Location ../../mcp
cargo test
cargo fmt -- --check
cargo build --release
```

実行ファイルの出力先は、リポジトリ直下から次の相対パス。

```text
code/apps/editor/src-tauri/target/release/clavierdesk.exe
code/apps/mcp/target/release/clavierdesk-mcp.exe
```

GUIの本番ビルドは`pnpm build:desktop`を使う。フロントエンドのビルドも含むため、別の`pnpm build`を同時に走らせない。今回、並行実行で`dist/assets`が置き換わり、Rustの埋め込み処理が古いアセット名を参照して失敗したことがあった。直列に再実行して成功している。

開発起動は`code`で`pnpm desktop`。Viteのポートは`127.0.0.1:1420`固定なので、複数セッションの確認にはビルド済みGUIを複数起動する方が扱いやすい。

### エージェントへの登録

利用するエージェントのローカルstdio MCP設定に、**新環境でビルドした`clavierdesk-mcp`の絶対パス**を登録する。引数は不要。GUIのexeや内部HTTPのURLを登録するのではない。

登録後、エージェントで`ping`、`list_clavierdesk_sessions`、`probe_session`が見えることを確認する。古いツール一覧が残っている場合は、使用中のMCPプロセスを再起動・再接続する。GUI・MCPとも同じソースからビルドしたものを使う。これをMCP世代管理の導入へ広げる必要はない。

## 6. 検証結果と再検証手順

### 今回確認したこと

| 項目 | 結果・範囲 |
| --- | --- |
| `pnpm check` | エラー0、既存警告3。EditorDialogのアクセシビリティ警告1件、notePreviewの初期値捕捉警告2件。 |
| WebView側MCPテスト | 4件成功。公開順序・ON/OFF・失敗後の解除と再試行・初期化・起動中の重複操作と破棄。 |
| MCPサーバーの`cargo test` | 4件成功。固定ツール一覧、接続先制限、IDのパス逸脱拒否、認証付きローカル通信。 |
| Tauri側の`cargo test` | 2件成功。要求パース、構造化エラー。 |
| Rustのformat check | 両Cargoプロジェクトとも成功。 |
| ビルド | フロントエンド、デスクトップGUI、MCPのreleaseビルド成功。 |
| stdio単体 | MCP初期化・ツール一覧・GUIなしで空のセッション一覧・不正ID拒否を確認。 |
| Windows実GUIとの接続 | ユーザーが開発版GUIでCtrl＋Mを操作。ON後に検出・WebView往復成功、OFF後に空一覧・旧IDの`SESSION_NOT_AVAILABLE`を確認。 |

実GUIへの操作は、Computer Useのアプリ承認がタイムアウトしたため、ユーザーが手動で行った。MCP側は[smoke.mjs](../../../code/apps/mcp/smoke.mjs)を実行し、実際のstdio JSON-RPCプロセスから検証した。特定エージェント製品への設定登録や、その製品に常設したツールからの呼び出しを検証した、という意味ではない。

### 実装済みだが実機確認が残ること

- 複数GUIを同時公開し、IDごとに正しいセッションへ届くこと。
- 公開ONのままアプリを終了した際の記述子削除と一覧除外。
- 公開ONのままアプリを再起動した際の旧ID無効化。
- WebView再読み込み、異常終了、実際のWebViewタイムアウト時の挙動。
- release版GUIでの同じ一連の操作。今回の実接続は開発版で確認し、release版はビルドまで確認。

終了・再起動・初期化の公開解除処理はコードに含まれる。上記は「未実装」ではなく、実機での未確認項目である。

### smoke.mjsを使った再検証

`code/apps/mcp`から実行する。以下のIDは、その場でGUIに表示された完全なUUIDへ置き換える。

```powershell
# GUI非公開でも、MCP初期化・ツール一覧・空一覧を確認できる
node smoke.mjs

# GUIでCtrl＋Mを押し、公開中のIDが検出されることとWebView往復を確認
node smoke.mjs ./target/release/clavierdesk-mcp.exe <sessionId>

# 再度Ctrl＋MでOFFにし、旧IDの一覧除外と接続拒否を確認
node smoke.mjs ./target/release/clavierdesk-mcp.exe --absent <previousSessionId>
```

`node smoke.mjs`だけでは、公開セッションが0件でも成功する。GUI接続を検証する際は期待するIDも渡す。スクリプトは公開中の各セッションへpingするが、譜面は変更しない。

MCPの一覧が空なのにGUIがONの場合は、まずGUIとMCPが同一ユーザーのデータ領域を使っているか、同じアプリIDか、ローカルTCPが許可されているかを確認する。今回、制限付き実行環境ではTCPテストが失敗し、通常のWindows実行権限で同じテストが成功した。

### 既存の全体テスト失敗

MCP追加後の全体テストで20件失敗した。HEADのソースを一時展開し、MCP作業前からあった上記2ファイルの変更を反映した比較環境でも、**同じ20件が失敗することを確認**した。MCP作業でこれらを修正したり、テストを無効化したりしていない。

保存済みTAPログはMCPテスト3件の時点のもので、追加後354件中334成功・20失敗、比較環境351件中331成功・20失敗。後から追加した初期化テストを含め、最終的なMCPテスト4件は個別に全件成功した。最終ソースの全体テスト件数として354件を固定値にしない。

失敗の所在は以下。根本原因はこの作業では調査・修正していない。

| `code/apps/editor/tests/`配下 | 失敗数 | 内容の目印 |
| --- | --- | --- |
| `domain-note-editing.test.mjs` | 1 | タイ列のピッチ移動と指番号保持 |
| `grace-input.test.mjs` | 1 | 装飾音のMusicXML出力 |
| `initial-values.test.mjs` | 1 | 初期調性変更と既存データ保持 |
| `key-hold.test.mjs` | 1 | キー保持のライフサイクル |
| `note-settings.test.mjs` | 1 | 段・声部ごとのモーダル項目 |
| `pedal.test.mjs` | 2 | 不正・重複イベント拒否、ペダル範囲の結合・短縮 |
| `pitch-collision.test.mjs` | 6 | 衝突を含む範囲の移動・移調拒否 |
| `score-preview-selection.test.mjs` | 1 | 選択色と既存スタイルの復元 |
| `timeline-cursor.test.mjs` | 5 | 下段の範囲操作、移調、配置拒否、音符移動、和音と指番号 |
| `trill.test.mjs` | 1 | タイ列途中のモーダル適用条件 |

ローカルの比較用ソース・ログは`code/apps/editor/temp/`にあり、Git管理対象外。別環境では上記の再現説明とテスト名を使い、ログの存在を前提にしない。

## 7. 次段階の設計に向けた材料（未確定）

**次に行うのは、データ・操作状態の取得と編集操作の設計。以下は検討材料であり、ツール仕様として合意済みではない。**

### 既存コードを利用できる場所

- [domain/score/types.ts](../../../code/apps/editor/src/domain/score/types.ts)：譜面モデル。音符・休符・和音・連符・装飾音・指番号／替え指などを持つ。
- [state/timeline-cursor.ts](../../../code/apps/editor/src/state/timeline-cursor.ts)、[outline-cursor.ts](../../../code/apps/editor/src/state/outline-cursor.ts)：段・声部・フォーカス音符・和音内ピッチ・選択アンカー・入力位置など。
- [App.svelte](../../../code/apps/editor/src/App.svelte)：現在の譜面、カーソル、各モード、ファイルdirty状態、モーダル下書き、再生状態・履歴の組み立て。
- [action/editor](../../../code/apps/editor/src/action/editor)：NoteEditor・OutlineEditor・PedalEditor・OttavaEditorの編集入口。
- [edit-transaction.ts](../../../code/apps/editor/src/action/editor/edit-transaction.ts)：トリル・テンポ・音部記号・スラーの参照整合処理。
- [editor-history.ts](../../../code/apps/editor/src/service/history/editor-history.ts)：譜面と操作状態のUndo/Redo。
- [domain/theory/musical-time.ts](../../../code/apps/editor/src/domain/theory/musical-time.ts)、[domain/score/score-timeline.ts](../../../code/apps/editor/src/domain/score/score-timeline.ts)：分数時間、音符の時間位置・小節との対応。

既存アーキテクチャでは、譜面の規則はdomain、意味のある編集と参照整合はaction、継続処理はservice、外部技術はinfraが担当する。MCP向けにキー入力を擬似実行する方式や、Rustへ譜面編集を複製する方式を前提にせず、共通の編集経路へ接続する。現actionにはカーソルを受けるものもあり、エージェント向けの明示対象指定との対応は設計が必要。

### 設計で詰める論点

1. **読み取りの粒度**：全体概要、選択と周辺、指定小節・段・声部・音符の詳細を、どの呼び出しで取得できると実用的か。
2. **位置と対象**：ユーザー向けの小節・拍・範囲と、内部ID・正確な分数時間をどう対応づけるか。小節追加・削除や連符も扱う。
3. **未保存と未確定の区別**：譜面に反映済みだがファイル未保存の状態と、モーダル・テキスト入力内の未確定下書きを区別する。
4. **編集の網羅性と効率**：全機能の対応表を作り、画像/PDFからの入力や範囲への運指設定を1音ずつの大量呼び出しにしない方法を検討する。
5. **結果・失敗の説明**：変更内容、変更なし、制約違反、関連する範囲表現への影響をエージェントが判断できる応答にする。
6. **履歴と一括処理**：Undo/Redoの単位、複数編集の一括適用、途中失敗時の扱いを既存の編集境界と合わせる。
7. **人との同時操作**：読み取り後に譜面や選択が変わった場合の検出と再取得。譜面の更新番号などはMCP世代管理とは別の論点で、現時点では未実装。
8. **表示・試聴**：ドラフトの確認を助ける選択・移動・再生等をMCPへ含めるか、その範囲を決める。

画像/PDF読み取りのためにアプリへOCRを内蔵すること、専用ドラフトモデルや自動運指エンジンを作ること、保存・別セッションへの自動転送を加えることは、現段階では確定していない。

## 8. Scorehackの参照元

今回の環境では、隣接する`C:/app/git/scorehack`を参照した。別環境に同リポジトリがなければ、この絶対パスは使えない。ClavierDeskの接続実装は本リポジトリ内にあり、Scorehackの実行ファイル・ソースへの実行時依存はない。

参照箇所はScorehack側の`apps/mcp`、`apps/tauri_app/src-tauri/src/mcp`、`src/system/service/mcp`、`memo/MCP_AI_ASSIST_HANDOFF.md`。Scorehack側の「まず読み取り専用」「後で提案承認」などの将来計画を、そのままClavierDeskの合意済み仕様にしない。ClavierDeskの要件と今回のMVP範囲は本資料の2節を優先する。
