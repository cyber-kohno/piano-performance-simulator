# 保守向け構成への移行方針

記録日：2026-11-03

既存のSvelte 5アプリを段階的に整理する。全面的な再実装はせず、既存の操作仕様とテストを維持する。再生処理をApp.svelteへ直接追加する前に、編集処理と整合処理の境界を整える。

## 合意したコード規約

- まとまりのある1責務を1ファイルにする。1関数1ファイルにはしない。
- 操作APIはTypeScriptのnamespaceにまとめ、default exportする。呼び出しは名前空間経由とし、関数名への所属名の重複を避ける。
- 内部の補助関数は公開しない。型は名前付きexportを許容する。Svelteコンポーネントなど、固有の公開方式を持つファイルはその方式に従う。
- 名前空間に可変な共有状態を隠さない。状態は引数、または明示的に生成したインスタンスへ保持する。音声エンジンなどのライフサイクルはサービス側から管理する。
- 既存APIは責務を移す段階で順に変更し、命名だけの一括置換はしない。

## フォルダ構成案（提案段階）

apps/editor/src/配下を次の責務で整理する。詳細なファイル分割は移行対象ごとに決め、空の層や将来用途だけの共通パッケージは作らない。

```text
domain/
  theory/       音価、拍子、調号、音程、分数時間などの音楽上の規則
  score/        プロジェクト、小節・声部・音符、タイ・範囲表現、譜面の制約
  performance/  譜面から演奏イベントを導出する規則
action/
  editor/       意味のある編集操作、対象解決、更新と参照整合処理の一括適用
  playback/     再生・停止など利用者操作の入り口
service/
  playback/     再生セッション、時刻・予約・停止処理の調整
  startup/      設定・SoundFontの初期化と起動状態
  project/      将来の保存・読み込みの手順
infra/
  audio/        SoundFontシンセ、AudioContextなど具体的な音声技術
  musicxml/     MusicXMLへの変換
  notation/     OSMD描画、配置・選択色など描画技術への依存
  tauri/        ローカルファイル、設定、ウィンドウ等のOS連携
state/          編集状態、選択、カーソル、モーダル下書き、再生表示状態
ui/
  components/   Svelteの表示コンポーネント
  keyboard/     キー入力を編集・再生操作へ対応づける処理
util/           音楽・編集・外部技術に依存しない汎用処理のみ
App.svelte      状態・操作・外部実装の組み立てと画面の配置
```

domainはSvelte、DOM、OSMD、Tauri、シンセに依存しない。theoryはプロジェクトやカーソルを知らず、score/performanceから利用する。performanceはscoreを読み、音声技術に依存しない演奏イベントを生成する。ミリ秒・秒への変換は導出処理であり、保存する譜面音価の置き換えにはしない。

actionは操作対象と必要な状態を受け取り、処理結果を返す。キー名を受け取って譜面を編集する責務は持たない。editorのactionが譜面変更後の整合処理を一括適用し、Appのキー処理に依存させない。serviceは継続的・非同期な処理を調整し、注入された外部APIを利用する。ドメインやサービスが必要とする外部APIの契約は利用側に置き、infraに具体実装を置く。Appなど組み立て箇所で接続する。

再生は「譜面→演奏イベント→再生制御→音声エンジン」の流れとする。編集・再生カーソルと保存データを分離し、演奏データ生成だけでもテストできるようにする。現在の音程試聴では、service/playbackが試聴時間・ベロシティと停止規則を持ち、infra/audioがSoundFontとAudioWorkletのライフサイクルを担当する。音程変更後の試聴はAppの組み立て箇所から呼び、譜面domainへ音声依存を持ち込まない。

移行順は、編集の共通境界、音楽規則・譜面参照の整理、Tauri最小構成と起動準備、通常ノート・タイ・テンポの再生、各演奏表現への拡張。フォルダ作成やコンポーネント細分化自体を目的にしない。

段階・確認項目・実施記録は[refactoring-plan.md](./refactoring-plan.md)で管理する。

第1段階ではaction/editorにNoteEditor・OutlineEditor・PedalEditorと共通のEditTransactionを導入した。Appはactionを呼び、整合処理を直接実行しない。既存の純粋な編集アルゴリズムはstate/modelに残して委譲しており、domainへの分解は次段階で行う。モーダル下書きの共通検証も現段階ではstateの既存関数を共有する。低水準関数をアプリケーションから直接呼び出す経路は増やさない。

TypeScriptのnamespaceはNodeの型除去のみでは実行できないため、テストコマンドには--experimental-transform-typesを指定する。現在のNode 24環境で実行確認する。Viteによるアプリのビルド方式は維持する。

段階2aではdomain/theoryとdomain/scoreへ基礎となる規則・保存型・譜面参照を移した。新domainに外側への依存がないことはテストで固定する。旧model等の互換exportは既存テストの入口を守るための別名のみであり、新実装の置き場にはしない。NotationGridは現在の32分単位というアプリの記譜解像度を扱うためscore側に置き、音価の数学的定義とは区別する。移行中の残りのmodel・stateは計画の段階2b・2cで整理する。

段階2bでは残る表現モデルと衝突制約をscore、音名・補助音計算をtheory、発音列・秒数変換をperformanceへ分離した。theory/score→performanceの依存は禁止し、演奏側が譜面を解釈する向きに固定する。旧modelはAPI互換用の委譲だけを保持する。OSMD/MusicXMLの表示・変換処理は引き続きinfra移行待ちである。

段階2c-1ではノートの音程・表現設定と音価分解を、カーソルを受け取らないdomain APIへ移した。action側は編集対象の解決と編集状態の更新を担当する。domainの局所的な変更に対し、範囲表現等の横断的な整合処理はactionのトランザクションでまとめる。アプリはdomainの低水準変更だけを呼んで参照整合を省略せず、actionを編集の入口とする。時間位置・連符等を含む残りの組み立ては段階2c-2で分離する。

段階2c-2では通常音符の時間編集をdomainへ移した。NoteTargetは段・声部・ノートID等の明示的な対象、NoteTimeResultは譜面と音楽上の編集結果を表す。domainはカーソルの選択状態や入力モードを知らない。stateの互換アダプターが入力単位を移動量に解決し、結果から編集状態を更新する。連符・装飾音とタイ追加／複製の残る組み立ては段階2c-3で分離する。

段階2c-3ではTupletNotes、GraceNotes、NoteContinuationを追加した。連符内の音価・時間とグループ移動、装飾音の保存データ更新、タイ追加／複製をdomainで扱い、stateはフォーカスの循環・入力単位の解決・結果のカーソル反映を扱う。複製された装飾音には新しいIDを与える。譜面変更後の範囲表現・イベント参照の整合は引き続きactionのEditTransactionが担当する。残るstate全体の責務整理と外部描画境界は段階3で扱う。

段階3aではプレビュー用MusicXMLの生成をinfra/musicxml、OSMDとSVGの処理をinfra/notationへ配置した。MusicXML変換はdomainを参照できるが、DOM・OSMD・Svelte・編集状態へ依存しない。notationは変換結果を受け取り外部描画を実行する。Svelteコンポーネントが表示ライフサイクルと描画の更新待ちを管理し、AbortSignalを渡す。外部描画の一時DOM管理はrendererが担当する。正式な全曲エクスポートとプレビュー範囲出力は今後も区別する。

段階3b-1ではノート設定モーダルをNoteSettingsの一つの編集状態へ集約した。stateはDOMイベントを操作せず、入力の値から下書きの次状態と確定要求を返す。Appがモードによる入口制御・preventDefault・キー保持解除・actionによる確定反映を担当する。下書きの制御と保存データの更新を別の責務として維持する。

段階3b-2ではPedalInputを入力解釈として分離し、譜面更新の実行はactionへ残した。TimelineViewは譜面からピクセル位置・目盛り・視覚的なノート間隔を導出する表示用の純粋な処理であり、domainには配置しない。UIが寸法を渡し、保存データにピクセル値を持ち込まない。スクロールの副作用とアニメーションは引き続きコンポーネント側で管理する。

段階3b-3ではui/keyboard/WorkspaceKeyboardを設けた。キーと保持フラグから編集actionを呼ぶ処理はUIの責務として配置し、action自体はキー名を受け取らない。ブラウザーのイベント抑止と入力先の優先制御はAppが担当する。EditorNavigationは音符を変更せず、カーソルとモードの遷移・同期を計算する。どちらも可変な共有状態を持たず、明示的な編集状態を受け取り次状態を返す。

段階3cではScorePedal・ScoreOutline・ScoreStaffへ残る構造更新を移した。stateの旧編集APIは互換アダプターであり、更新規則の実装元ではない。アウトラインのデータ操作は対象ブロックIDと音楽上の変更内容を受け取り、actionがカーソルへ結果を反映する。段階1～3を再生実装前の整理の確認地点とし、ここからTauri起動とSoundFont初期化へ進む。既存コンポーネントの物理配置や互換exportの全廃は、再生の追加に必要な条件とはしない。

段階4cではSF2をpublic/assets/soundfontsへ追加し、起動画面からメイン表示へ切り替える前にSoundFontとAudioWorkletを初期化する。infra/audio/SpessaSynthInstrumentは具体的な音声実装、service/playback/NotePreviewは音程変更の試聴規則を担当する。編集actionとdomainは音声を再生せず、Appがピッチ変更前後を比較して試聴を呼び出す。WebAudioの再生許可は最初のキー操作時にAudioContextを再開して得る。

Tauri化MVPでは実装先をcode/apps/editorへ変更し、既存のappsはprototypesへ移した。codeのみをpnpmワークスペースとし、共通基盤分割はMVPの後とする。現段階では編集のdomain・action・state・ui・infraをeditor内に保持し、Tauri側はウィンドウ起動のみを担当する。実施結果は[tauri-mvp.md](./tauri-mvp.md)を参照。

## 追加：起動スプラッシュ

Tauri化MVPの後に、SoundFontなしの起動スプラッシュを追加した。mainを隠して起動し、Svelteの初期更新完了通知でmainを表示してからスプラッシュを閉じる。固定の表示時間は設けない。ウィンドウ切替はsrc-tauri/src/startup.rs、フロント側のTauri通知はinfra/tauri/desktop-startup.tsへ置き、Appや譜面domainに混在させない。ブラウザー起動では通知を省略する。
