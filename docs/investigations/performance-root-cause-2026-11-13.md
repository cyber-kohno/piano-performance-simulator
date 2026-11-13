# ノート編集のパフォーマンス差の根本調査

調査日: 2026-11-13。ClavierDeskの調査対象: `47e858a`。Scorehackは隣接するローカルソースを参照した。製品コードの変更は行っていない。

## 結論

大きな差は、ClavierDeskが「不変スナップショットによる譜面全体のルート更新」と「全階層を深く監視するSvelteの `$state`」を併用し、そのルート変更を検索・派生計算・表示部品へ広く伝える構造にある。

さらに、移動・音価変更には全譜面の記譜列を何度も展開する処理が残り、楽譜プレビューには別の高コストな描画処理がある。単一関数の修正やDOMの表示数制限では、この組み合わせを解消できていない。

Scorehackもグローバルストアを使う。全ノートの表示候補走査や、履歴追加時の全データのfingerprint生成もある。「Scorehackは全体処理を一切しない」「ノートごとに独立したストアだから速い」という説明はソースと一致しない。

## Scorehackとの実装差

| 観点 | Scorehack | ClavierDesk |
|---|---|---|
| ノートの編集情報 | `norm / pos / len / pitch` をノートが直接保持 | 記譜された音価・休符・連符の列から位置と長さを算出 |
| 音高変更 | フォーカス番号からノートを取得し `note.pitch` を更新 | note ID検索、タイ列の取得、和音更新、衝突確認、新しいprojectの発行 |
| 更新対象 | 対象ノートを変更し、plain objectをwritable storeへ通知 | 変更経路のオブジェクトをコピーし、deep proxyのルートを置き換える |
| 移動・長さ変更 | 対象ノートの候補を作り、トラック内の単純な位置・長さで重なりを確認 | 声部の記譜列展開、休符の復元、連符・タイ・複数声部・表現の整合確認 |
| ノート表示 | `Note.svelte` に部品化。表示候補の全体走査自体はある | 大きなTimelinePanel内で多くの表示用配列・集合・経路を再構成 |
| 楽譜の浄書 | 該当するノート編集経路にはOSMD再描画がない | MusicXML生成、新しいOSMDのload/render、SVG後処理 |

Scorehackの位置・長さをそのまま保存形式へ移植する必要はない。ClavierDeskの記譜中心の保存モデルを保ち、編集用の位置・範囲索引を増分更新する方法が適している。

参照箇所:

- [Scorehackのストア](C:/app/git/scorehack/apps/tauri_app/src/system/store/global-store.ts)
- [Scorehackのノートモデル](C:/app/git/scorehack/apps/tauri_app/src/system/store/state/data/melody-state.ts)
- [Scorehackの音高更新](C:/app/git/scorehack/apps/tauri_app/src/system/service/melody/melody-updater.ts:93)
- [Scorehackの移動・伸縮](C:/app/git/scorehack/apps/tauri_app/src/system/service/melody/note-position-updater.ts:68)
- [Scorehackの更新通知](C:/app/git/scorehack/apps/tauri_app/src/system/actions/melody/melody-actions.ts:69)
- [Scorehackの表示候補抽出](C:/app/git/scorehack/apps/tauri_app/src/system/component/melody/score/ActiveMelodyNotes.svelte:97)
- [Scorehackのノート表示部品](C:/app/git/scorehack/apps/tauri_app/src/system/component/melody/score/Note.svelte:14)
- [Scorehackの履歴・未保存判定](C:/app/git/scorehack/apps/tauri_app/src/system/infra/tauri/history/score-history.ts)

## ブラウザーでの切り分け

実際のOutlinePanel / TimelinePanel / ScorePreviewを使う隔離画面を作成し、同じPCのMicrosoft Edgeで自動実行した。開いているClavierDesk / Scorehackの未保存譜面は操作していない。検証用サーバーと画面は調査後に終了し、一時ファイルは削除する。

条件:

- 4/4、上下段各1声部、各小節を16分音符で埋める。
- 操作の成功を確認できるよう、中央小節の上段の先頭ノートの直後だけ16分休符とする。
- 中央小節の先頭ノートの音高・左右移動・16分/8分の音価変更を交互に16回行う。全ケースで編集拒否は0回。
- 各編集後にSvelteのtickとレイアウト確定を待ち、40ms待機して次の編集へ進む。
- 表示領域1280×800。表示中のピッチDOMは各ケース111個。非表示音域の列背景を保持する現行実装を使う。
- 編集計算と、更新後のSvelte処理・レイアウト確定を別々に計測する。
- 楽譜プレビューを表示する場合としない場合を比較する。
- 未保存判定と簡易な履歴保持は含める。音源・Tauri IPC・App全体のキールーティングは含めない。

中央値（ms）、楽譜プレビューなし:

| 小節数 | 操作 | 開発版: 編集計算 | 開発版: Svelte更新＋レイアウト | 製品向けビルド: 編集計算 | 製品向けビルド: Svelte更新＋レイアウト |
|---|---|---:|---:|---:|---:|
| 8 | 音高変更 | 1.0 | 21.5 | 1.0 | 9.3 |
| 8 | 左右移動 | 8.4 | 25.5 | 8.0 | 8.4 |
| 8 | 音価変更 | 3.3 | 28.1 | 4.7 | 8.1 |
| 100 | 音高変更 | 6.9 | 41.9 | 5.6 | 14.6 |
| 100 | 左右移動 | 65.5 | 47.3 | 47.5 | 13.1 |
| 100 | 音価変更 | 37.9 | 46.2 | 35.0 | 13.8 |

各列はそれぞれの中央値であり、列の和をエンドツーエンドの中央値と解釈しない。更新時間にはレイアウトの強制確定が含まれ、純粋なJavaScriptの再評価時間だけを表すものではない。

重要なのは、8小節の音高変更では編集関数が約1msでも、その後の更新が約22msある点である。これまでの編集関数や派生値だけのヘッドレス計測では、この差を捉え切れていなかった。

また、ピッチDOM数が111個のままでも小節数とともに遅くなっている。全ノートのDOMを描画してしまっていることだけが原因ではない。

## 深いリアクティブ監視と更新方法の不一致

[Appのproject](C:/app/git/piano-performance-simulator/code/apps/editor/src/App.svelte:116) は `$state` のdeep proxyであり、編集後はprojectルートを置き換えている。deep proxyの細かなプロパティ監視を行いつつ、immutable更新で親参照も変更している。

検証画面だけで、projectの宣言を `$state` から `$state.raw` に変更して同じ編集・同じ表示部品を動かした。他の編集ロジックは変更していない。カーソルは引き続き通常のリアクティブステートである。

100小節、開発版、楽譜プレビューなし:

| 操作 | 通常のdeep state: 編集計算 | raw state: 編集計算 | 通常のdeep state: 更新＋レイアウト | raw state: 更新＋レイアウト |
|---|---:|---:|---:|---:|
| 音高変更 | 6.9 | 1.7 | 41.9 | 17.0 |
| 左右移動 | 65.5 | 7.8 | 47.3 | 29.0 |
| 音価変更 | 37.9 | 7.6 | 46.2 | 22.6 |

これは、deep proxy経由の大量のプロパティ参照・依存追跡が、現在の全体走査と組み合わさって負荷を大きくしている証拠である。raw stateへの変更だけでは表示更新と全体走査が残り、目標の操作感に到達したとはいえない。

本体へ導入する場合は、すべてのproject編集がimmutableであることを確認し、Undo/Redo・読込・保存・MCP編集も含めて検証する必要がある。Scorehackと同じようにデータを直接書き換える実装を、現在の参照共有型Undoにそのまま入れると履歴を破壊する。

## 編集計算が譜面全体へ広がる箇所

準備済みの入力譜面から1回の編集を行い、ScoreVoiceの公開メソッド呼び出しを数えた。flatten内から呼ばれる内部locateは、locate列へ重複計上していない。

| 小節数 | 操作 | flatten呼び出し | locate呼び出し |
|---|---|---:|---:|
| 8 | 音高変更 | 3 | 0 |
| 8 | 左右移動 | 73 | 16 |
| 8 | 音価変更 | 57 | 9 |
| 100 | 音高変更 | 3 | 0 |
| 100 | 左右移動 | 901 | 200 |
| 100 | 音価変更 | 701 | 101 |

音高変更の局所化は編集関数内では効いている。一方、移動・音価変更の処理量は依然として全譜面に比例する。

- [NoteMovement](C:/app/git/piano-performance-simulator/code/apps/editor/src/domain/score/note-movement.ts:49) は対象でない小節もlocateしてから変更の有無を調べる。その後、タイの整合確認も全体に行う。
- [NoteSpan.hasTuplet](C:/app/git/piano-performance-simulator/code/apps/editor/src/domain/score/note-span.ts:13) は対象時間と重ならない小節の声部も展開する。
- [EditTransaction.commit](C:/app/git/piano-performance-simulator/code/apps/editor/src/action/editor/edit-transaction.ts:21) は通常の移動・音価変更で、変更前後のフェルマータ時刻情報と競合を全体確認する。
- [MusicalTime](C:/app/git/piano-performance-simulator/code/apps/editor/src/domain/theory/musical-time.ts) による正確な分数処理を、これらの展開で繰り返す。分数精度を捨てるのではなく、変更範囲以外の再計算を避けるべきである。

## キャッシュがあってもルート変更で広く再評価される

[ScoreTimeline](C:/app/git/piano-performance-simulator/code/apps/editor/src/domain/score/score-timeline.ts:19) のnoteCache / idCacheはoutline配列をキーにしている。ノート編集で新しいoutlineになると、旧版の検索Mapをそのまま使うことはできない。

変更のない小節の展開結果は再利用しているが、全小節からの配列の組み立てと全ノートのID Map構築は新版ごとに残る。したがって「flattenが少数に減った」ことは「編集後の処理が全ノート数に依存しなくなった」ことを意味しない。

[TimelinePanel](C:/app/git/piano-performance-simulator/code/apps/editor/src/components/TimelinePanel.svelte) では、ルートoutlineやcursorのオブジェクト参照を多くの派生値・表示式が参照する。表示範囲が同じでも、新しい配列・Set・表示用オブジェクトやcursorが流れることで再評価が広がる。実際にどの表示式がCPU時間の何割を使うかは、今回の更新時間計測だけでは完全に分解できていない。

## 楽譜プレビューの独立した負荷

[ScorePreview](C:/app/git/piano-performance-simulator/code/apps/editor/src/components/ScorePreview.svelte) は80ms待ってから生成を開始する。[ScorePreviewRenderer](C:/app/git/piano-performance-simulator/code/apps/editor/src/infra/notation/score-preview-renderer.ts) は毎回新しいOSMDインスタンスを作り、MusicXMLをloadし、renderし、SVGを後処理する。

今回の16回連続変更では、待機によるキャンセルは機能し、各ケースの実描画は最後の1回だった。全キー入力で16回浄書しているという結果ではない。

その1回のrender全体は概ね35〜75msだった。これはasync関数の経過時間で、すべてがメインスレッドを占有したCPU時間だとは断定しない。ただし8小節の音高変更では、プレビューありで約67〜70msのフレーム間隔も観測した。

プレビューを外しても移動・音価変更と表示更新の重さは残るため、プレビューだけを原因として対処を終えるのは不適切である。

## 開発版と製品向けビルド

現在起動中のClavierDeskは `src-tauri/target/debug/clavierdesk.exe`。Scorehackはデスクトップ上のexeであり、その配布バイナリがどの条件で作られたかは今回確認できていない。

同じ隔離画面の製品向けビルドではSvelte更新時間が短縮した。8小節の音高変更は約22msから約9ms、100小節の移動は約47msから約13msになった。

ただし、製品向けビルドでも100小節の移動計算は約48ms、音価変更計算は約35ms残る。開発ビルドの差だけで根本問題を片付けることはできない。最終比較は双方の製品向けビルドで行う必要がある。

## 次の設計変更の優先順

1. immutable更新とstateの観測方法を合わせる。まずprojectをrawなスナップショットとして扱う案を検証し、深いProxyの負荷を除く。カーソル・モーダルのローカルなリアクティブ状態は別に扱う。
2. ノートID→小節・声部・位置の編集用索引を安定して保持し、編集コマンドが変更ID・小節・時間範囲を渡す。全キャッシュをprojectの単一の版だけに依存させない。
3. 移動・音価変更のlocate、休符再構成、衝突、連符・タイ・表現の整合確認を、変更範囲と接続先へ限定する。長いタイを実際に編集する場合は、そのタイ列の範囲は必要となる。
4. 表示用データは小節・ノート単位で参照を維持し、ノート表示を部品化する。選択や声部などの値は安定したプリミティブ値・最小限のpropsに分け、無関係なノートの表示式へ変更を伝えない。
5. 楽譜プレビューはピアノロールの即時応答から独立させ、同じ表示内容の再生成防止、入力停止後の更新、レンダラー再利用などを検討する。単に非表示にすることを最終解決にしない。

保存モデルの記譜精度・タイ・複数声部・Undo・MCP編集は維持する。テンポと小節ヘッダの経過秒数表示は、今回の実装対象にしない。

合格判定には、100小節の密な16分音符、編集成功・拒否、長押し、Undo/Redoを使い、編集関数の時間だけでなく、入力から次の表示までの時間・フレーム間隔・長い停止も含める。今回のraw state実験だけでScorehackと同水準に到達したとは判断しない。

## 計測の限界とデータ

この計測は同じPC上で実部品を動かす隔離画面であり、ユーザーの検証譜面そのものや、Scorehack製品バイナリとClavierDeskの全機能を含む同条件のCPUプロファイルではない。オーディオ・IPC・App全体の入力処理の負荷は除外している。

各ケースは16操作の中央値。JITやGC、ケース順序、ブラウザーの状態による変動があるため、数値や速度倍率の保証には使わない。ソース上の更新範囲と、切り分け実験による傾向を確認するためのデータである。

観測値と計測条件は [JSONデータ](C:/app/git/piano-performance-simulator/docs/investigations/performance-root-cause-2026-11-13.json) に保存した。
