# ClavierDesk

ピアノの音楽を入力し、聴き、観て、調整するための作業環境を開発しています。

- [製品の思想・名前・アイコン](docs/product/clavierdesk.md)
- [デスクトップエディターの起動手順](code/apps/editor/README.md)
- [設計と移行計画](docs/plan/score-domain-model/refactoring-plan.md)
- [MCP開発の引継ぎ資料](docs/plan/mcp/handoff.md)

## 配置

```text
code/
  apps/editor/       本開発：Svelte 5 + Tauri
  packages/          将来の共通基盤の配置予定（現在は未作成）
prototypes/
  editor/            移行前の検証エディター
  3d-motion-lab/     3D演奏の研究アプリ
docs/               思想・仕様・開発計画
```

ローカルエージェント向けの[MCPサーバー](code/apps/mcp/README.md)はcode/apps/mcpにあります。デスクトップ版でCtrl＋Mを押すとセッション公開を切り替えられます。現在は検出・疎通確認のみ対応しています。
