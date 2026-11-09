# ClavierDesk MCP

ローカルのエージェント向けstdio MCPサーバー。Scorehackの接続実装を基にしています。アプリとは別のプロセスで起動し、GUIの起動・停止にかかわらずツール一覧は固定です。

接続基盤については[MCP開発の引継ぎ資料](../../../docs/plan/mcp/handoff.md)、現在の編集・排他仕様については[チェックアウトとUI入力](../../../docs/plan/mcp/checkout-and-ui.md)を参照してください。

次段階は、空からまとまった譜面を構築してGUIで確認するMVPです。[要件・設計方針・別環境への引継ぎ](../../../docs/plan/mcp/score-authoring-mvp-handoff.md)を再開入口にしてください。新規構築操作・操作配列はまだ実装していません。

## ビルドと登録

このディレクトリで実行します。

```powershell
cargo test
cargo build --release
```

エージェントのローカルstdio MCP設定に、生成された実行ファイルの絶対パスを登録します。Windowsでは`target/release/clavierdesk-mcp.exe`です。引数は不要です。stdoutはMCPのJSON-RPC専用です。

## GUIから公開する

1. ClavierDeskのデスクトップ版を起動します。起動時は非公開です。
2. Ctrl＋Mを押します。WebViewまでの疎通確認後、ヘッダーに`MCP ON`と完全なセッションID（UUID）が表示されます。IDは文字選択してコピーできます。
3. エージェントから`list_clavierdesk_sessions`を呼び、画面のIDと一致するセッションを選びます。
4. その完全なIDを`probe_session`へ渡します。`gui: { application: "ClavierDesk", status: "ok" }`が返れば、stdio→Rustブリッジ→WebView→応答の経路が通っています。
5. Ctrl＋Mを再度押すと`MCP OFF`になり、一覧から消え、そのIDへの要求も失敗します。

複数のClavierDeskを起動し、それぞれ公開できます。自動で対象を一つ選ぶことはなく、`probe_session`には毎回`sessionId`が必要です。公開し直すと新しいIDになります。アプリ終了時は接続と記述子を破棄します。異常終了で記述子が残っても、生存確認に失敗するため一覧へ出ません。

ブラウザー版は公開対象外です。公開失敗時は`MCP ERROR`を表示し、詳細はホバーで確認できます。Ctrl＋Mで再試行できます。

## ツール

| 名前 | 用途 |
| --- | --- |
| `ping` | MCPサーバー単体の疎通。GUI不要。 |
| `list_clavierdesk_sessions` | 公開中かつ認証付き生存確認に成功したセッションのID・PID・公開開始時刻。 |
| `probe_session(sessionId)` | 指定セッションのWebViewまで疎通確認。 |
| `begin_checkout(sessionId)` | 編集権取得とUIロック。返された`checkoutId`を以降の要求に使う。 |
| `get_editor_state(sessionId, checkoutId)` | 作業用の譜面・カーソル・選択・未保存状態を取得。 |
| `apply_edit(sessionId, checkoutId, …)` | 作業用データに編集を蓄積。現在は`set_pitch_fingering`のみ。 |
| `finish_checkout(sessionId, checkoutId)` | 全編集を一度だけ実プロジェクト・Undo履歴に反映し、所有権とUIロックを解除。その後で完了通知。 |

入力の下書き、メニュー、ダイアログ、ファイル操作、再生がある間は`EDITOR_BUSY`でチェックアウトを拒否します。下書きを自動確定・破棄しません。

チェックアウト中は、画面の`Stop MCP editing`ボタンまたはCtrl＋Shift＋Mで強制停止できます。未反映の編集を破棄し、UIロックを解除してから通知します。以前の`checkoutId`は無効になり、同じエージェントが再チェックアウトしても遅延要求を拒否します。反映後の変更はUndoで戻します。

編集ツールの`changed`は作業用データの変更を表します。実プロジェクトへの反映は`finish_checkout`で行い、自動保存はしません。汎用の操作配列・条件クエリ・全構造検証、MCP世代管理は未追加です。GUIとMCPサーバーを同じソースからビルドし、ツールスキーマ変更後はMCPクライアントを再接続してください。

## 接続方式

```text
Agent ↔ stdio ↔ clavierdesk-mcp
  ↔ authenticated loopback HTTP ↔ Tauri
  ↔ clavierdesk://mcp/request / mcp_respond ↔ main WebView
```

Tauriは動的なIPv4ループバックポートを確保し、アプリのローカルデータ領域の`mcp/sessions/<sessionId>.json`へ接続記述子を置きます。アプリIDは`com.clavierdesk.editor`です。Windowsでは`%LOCALAPPDATA%/com.clavierdesk.editor/mcp/sessions`を使います。

記述子の認証トークンはローカル接続専用で、ツールの応答に含めません。MCPサーバーは記述子の形式・接続先・認証付き`/health`のIDを検証します。`POST /bridge`は要求をメインWebViewへ転送し、5秒でタイムアウトします。

## stdioを直接検証する

GUIを公開した状態で、このディレクトリから実行します。Node.js 24系が必要です。

```powershell
node smoke.mjs
# 対象セッションが存在することも確認する場合:
node smoke.mjs ./target/release/clavierdesk-mcp.exe <sessionId>
# 公開解除したIDが一覧から消え、接続も拒否されることを確認する場合:
node smoke.mjs ./target/release/clavierdesk-mcp.exe --absent <previousSessionId>
```

MCP初期化、ツール一覧、セッション一覧、公開中の各WebViewへの疎通、不正なIDの拒否を確認します。公開セッションが0件でも、MCPサーバー単体の検証は成功します。
