# ClavierDesk MCP

ローカルのエージェント向けstdio MCPサーバー。Scorehackの接続実装を基にしています。アプリとは別のプロセスで起動し、GUIの起動・停止にかかわらずツール一覧は固定です。

要件・実装構成・検証結果・別環境での再開については、[MCP開発の引継ぎ資料](../../../docs/plan/mcp/handoff.md)を参照してください。

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

このMVPは接続のみを扱います。譜面・カーソル・選択範囲・編集中の下書きは取得せず、編集・保存・再生も行いません。MCP世代の管理は導入していません。

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
