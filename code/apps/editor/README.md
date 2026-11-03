# ClavierDesk Editor

本開発のエディターです。現行の譜面モデル・キー操作を引き継ぎ、Svelte 5 + TypeScript + ViteをTauri 2で動かします。

[製品の思想](../../../docs/product/clavierdesk.md)／[設計資料](../../../docs/plan/score-domain-model/score-domain-model.md)／[移行計画](../../../docs/plan/score-domain-model/refactoring-plan.md)

## 開発

Node.js 24系、pnpm 11.25.0、Rust、WindowsのTauri開発環境（Microsoft C++ Build Tools・WebView2）が必要です。

リポジトリのcodeディレクトリで実行します。

```powershell
pnpm install --frozen-lockfile
pnpm desktop
```

依存関係のインストール後は、このアプリのディレクトリ（code/apps/editor）から通常のnpmコマンドでも起動できます。Tauriの起動前コマンドもnpmを使うため、起動時にpnpmがPATHに存在する必要はありません。

```powershell
npm run tauri dev
```

同じディレクトリでnpm run tauri build -- --no-bundleを実行すると、インストーラーを作らず実行ファイルをビルドします。依存管理とlockファイルは引き続きcodeのpnpmワークスペースに統一します。

最初の起動はRustのコンパイルに時間がかかります。Viteは127.0.0.1:1420を固定で使い、使用中なら別ポートへ自動変更せずエラーにします。

ブラウザーだけで確認する場合：

```powershell
pnpm dev
```

## 確認・ビルド

codeディレクトリで実行します。

```powershell
pnpm check
pnpm test
pnpm build
pnpm build:desktop
```

buildはフロントエンド、build:desktopはフロントエンドを含むデスクトップ実行ファイルのビルドです。インストーラー作成・配布・署名はMVPに含みません。Windowsでの出力先はapps/editor/src-tauri/target/release/clavierdesk.exeです。

## MVPの範囲

- 現行エディターのキー入力、編集、各モード、追従スクロール、設定モーダル、OSMDプレビューを維持する。
- 初期サイズ1400×900、最小サイズ1100×800。フロント側の最低サイズと揃える。
- アプリ名・ウィンドウタイトルはClavierDesk。02 / Cursor案を元にpublic/icon.svgをマスターとして実装し、Tauri用アイコンを生成する。
- SoundFont、音声再生、ファイル保存・読込、MCP、共通パッケージ分割は後続段階。

現在のアプリ識別子はcom.clavierdesk.editorです。配布や保存領域の仕様を固める際に確認してください。

## アイコン再生成

このディレクトリで実行します。

```powershell
pnpm tauri icon public/icon.svg --output src-tauri/icons
```

## 構成

srcのdomain・action・state・ui・infraはプロトタイプで整理した境界を維持しています。src-tauriは最小のデスクトップ起動のみを担当し、編集ロジックはRustへ複製しません。

codeはpnpmワークスペースです。ルートのpnpm-lock.yamlと、src-tauri/Cargo.lockを管理します。npmのlockファイルやアプリ単位のpnpmワークスペースは追加しません。

## 起動と音声プレビュー

Tauri起動時は360×260のスプラッシュを表示し、ピアノSoundFontとAudioWorkletシンセの準備完了後にメイン画面へ切り替えます。SoundFontはpublic/assets/soundfonts/clavierdesk-grand-piano.sf2に配置し、Viteのアセットとして同梱します。読み込みに失敗した場合もエディターを開き、音声プレビューが利用できないことを表示します。

フォーカス中のノートのピッチが編集された場合、そのノートのピッチ（和音なら全音）をscorehackに合わせて0.5秒試聴します。カーソル移動だけでは鳴らしません。音声エンジンはinfra/audio、試聴の音量・長さ・停止規則はservice/playbackが担当します。ブラウザー起動でも音源を読み込めますが、WebAudioの制約により最初のキー操作時にAudioContextを再開します。

public/splash.htmlが起動画面、infra/tauri/desktop-startup.tsとsrc-tauri/src/startup.rsがウィンドウ切替を担当します。SoundFont読込はこの切替通知より前に行います。
