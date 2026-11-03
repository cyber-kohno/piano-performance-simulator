# ClavierDesk：Tauri化MVP

記録日：2026-11-03

## 完了した範囲

現行editorの編集機能を引き継ぎ、WindowsのTauriアプリとして起動できる状態にした。共通基盤のパッケージ分割は含めない。

```text
code/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  apps/editor/
    src/                現行の編集ロジックとSvelte UI
    tests/              既存351テスト
    public/icon.svg     採用したCursor案のSVGマスター
    src-tauri/          Tauriの起動・ウィンドウ・アイコン設定
prototypes/
  editor/               移行前の参照版
  3d-motion-lab/         3Dの研究アプリ
```

MCP・CLI等は将来code/appsへ追加する。共通基盤の配置予定はcode/packages/coreだが、MVPでは空パッケージを作っていない。

## 移行内容

- appsをprototypesへ移し、editorのsrc・testsをcode/apps/editorへ引き継いだ。ソースとテストの一致をハッシュで確認し、Appの変更は製品名表示に限定した。
- 旧サーバー停止と移動時の一時的な依存ファイルはtemp配下へ退避し、Git管理対象外にした。ソースの正本はprototypes／codeにある。
- code内をpnpmワークスペースとした。フロント依存はワークスペース単位のlock、RustはCargo.lockで固定する。旧版はワークスペースに含めない。
- Tauri 2の最小起動を追加した。Rust側に譜面編集を複製せず、既存のSvelte UIを表示する。
- ウィンドウはClavierDesk、初期サイズ1400×900、設定上の最小サイズ1100×800。現行CSSの最低サイズに合わせた。
- 採用済みの02 / Cursor案をSVGで実装し、Tauri CLIでWindows／macOS／PNGアイコンを生成した。タイトルバーで独自アイコンを確認した。
- 開発時は127.0.0.1:1420を固定で使う。本番はビルド済みフロントエンドを埋め込み、開発サーバーを使わない。
- Viteの監視からsrc-tauriを除外し、Rustの生成物によるフロントの不要な再読み込みを防ぐ。
- ファイルアクセス等のプラグインや独自IPCコマンドは追加していない。Capabilityはcore:defaultのみ。CSPは自己配信のスクリプトを基本とし、OSMDが生成するインラインスタイルを許可する。開発用接続先は開発CSPへ分けた。

## 確認結果

- 移行後の351テスト成功。
- Svelte／TypeScriptの型チェック：エラー・警告なし。
- フロントの本番ビルド成功。OSMDのチャンクサイズ警告は従来どおり残る。
- cargo fmtのチェック成功。
- Windows debugビルドとreleaseビルド成功。
- 開発版の実ウィンドウで小節追加、モード切替、ノート配置、設定モーダル、段・声部切替、OSMDの描画を確認。
- release実行ファイルを別起動し、WebViewのURLがhttp://tauri.localhost/であることと、ノート配置・楽譜表示・選択色・スタッカート設定確定・第3小節への移動と横スクロール追従を確認。
- ウィンドウ最小寸法は設定値を確認した。縮小ドラッグによる実測確認は未完了。

Windows以外のネイティブビルド・実機確認は行っていない。インストーラー、署名、配布も対象外。

## 起動と出力

詳細は[Editor README](../../../code/apps/editor/README.md)を参照。

通常のnpm起動にも対応する。code/apps/editorでnpm run tauri devを実行でき、beforeDevCommand／beforeBuildCommandはそれぞれnpm run dev／npm run buildを使用する。pnpmがPATHにない環境でも、依存インストール済みならTauriの起動・ビルドを行える。

codeでpnpm desktopを実行すると開発起動する。pnpm build:desktopはWindowsの実行ファイルをcode/apps/editor/src-tauri/target/release/clavierdesk.exeへ生成する。実行環境にはWebView2が必要。

ファイル保存・読込は未実装のため、終了時に制作内容を永続化する機能はない。

## 次の区切り

Tauri化と共通パッケージ分割を同時に行わず、まず現行editorが動くことをMVPとする合意に沿って、ここを確認地点とする。共通基盤の切り出しは独立した後続課題とする。SoundFont初期化とプレビュー再生は別の確認地点として段階的に実装した。

参照した公式資料：[Vite連携](https://v2.tauri.app/start/frontend/vite/)、[アイコン生成](https://v2.tauri.app/develop/icons/)。
