# ClavierDesk

ピアノの音楽を入力し、聴き、観て、調整するための作業環境を開発しています。

- [製品の思想・名前・アイコン](docs/product/clavierdesk.md)
- [デスクトップエディターの起動手順](code/apps/editor/README.md)
- [設計と移行計画](docs/plan/score-domain-model/refactoring-plan.md)

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

MCP・CLI等は将来code/apps配下へ追加します。Tauri化のMVPでは共通パッケージの切り出しを行いません。
