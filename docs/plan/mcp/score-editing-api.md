# MCPによる継続的な譜面編集

更新：2026-11-10。現行仕様。新規構築MVPから、既存譜面の取得・追加・修正・表現設定へ拡張した。

画像から音符を認識する責務はエージェントにある。以下は認識済みの音楽データをアプリへ渡し、状態を再取得して編集するAPIであり、画像認識機能ではない。

## ツールと編集の流れ

公開セッションを一覧・GUIで照合してprobeした後、次を繰り返す。

1. `get_capabilities(sessionId)`で対応操作と制限を確認。operation名を追加指定すると、その操作の正確な引数スキーマを取得できる。
2. `get_score_overview(sessionId)`で設定・小節番号・小節ID・セクションとrevisionを取得。
3. `get_score_range(sessionId, firstMeasure, measureCount, staff?, voiceIndex?)`で対象の音符・装飾・参照・イベントを取得。ここまではUIをロックしない。
4. `begin_checkout`でcheckoutIdとrevisionを取得。事前の読み取りとrevisionが異なる場合は対象範囲を再取得する。
5. `apply_edit(sessionId, checkoutId, requestId, expectedRevision, operations)`を送る。
6. 必要に応じてcheckoutId付きの範囲取得と追加編集を繰り返す。
7. `finish_checkout`で一度だけ反映し、ロックを解除。ユーザーが完了通知を閉じて表示・試聴を確認する。
8. 再取得・再チェックアウトして修正や追加を続ける。

`cancel_checkout`は自分の作業用データを破棄して解除する。GUIの強制停止も維持。従来の`get_editor_state`はcheckoutId必須の全件取得として残すが、大きな譜面は範囲取得を使う。

ツールは従来7個＋`get_capabilities`・`get_score_overview`・`get_score_range`・`cancel_checkout`の11個。専門編集はツールを増やさず、共通のapply_editに型付き操作として渡す。

## revisionと再送

revisionは内容を識別する不透明な文字列。新しいバッチは最新のチェックアウトrevisionをexpectedRevisionへ渡す。成功応答のrevisionを次の要求で使用する。古い読み取りからの要求はSTALE_REVISIONで拒否する。

同じrequestIdの再送は、最初のexpectedRevisionとoperationsをそのまま使う。同じ内容なら以前の結果を返し、二重適用しない。古い成功応答に含まれるrevisionは履歴時点の値なので、後続編集済みなら再取得する。失敗要求はキャッシュしない。オブジェクトのキー順を無視し、配列順・値を比較する。

既存の単一operation=set_pitch_fingering形式は互換用として残す。新しい操作配列形式ではexpectedRevisionが必須で、以前の構築バッチも更新が必要。

finish_checkoutは公開時点の実プロジェクトとの競合を検査する。終了・停止済みのcheckoutIdは拒否する。finish/cancel自体の再送成功応答キャッシュは設けていない。

## 操作一覧

| 操作 | 主な指定と意味 |
| --- | --- |
| create_score | 空のプロジェクトにsettingsとmeasuresを作成 |
| append_measures | 既存曲の末尾に追加。以前のチェックアウトで作った曲にも使用可 |
| insert_measures | afterMeasureIdの後へ追加。nullなら必須の先頭セクションの直後 |
| remove_measures | measureIdsの小節だけを削除。隣接するセクション・調号ブロックは保持 |
| replace_voice | measureId・staff・voiceIndexの声部全体をeventsで置換。voiceIndexが声部数と同じなら新しい声部を追加 |
| remove_voice | 指定声部を削除。段の最後の1声部は削除不可 |
| set_pitches | noteIdの和音全体の絶対音名を設定。音符ID・音価・音符付随表現は保持。同じMIDI音高の運指を保持し、新しい音高には付与しない |
| set_value | 音符・休符のelementIdと音価。開始位置は声部内の順序から再計算。休符を自動補完しない |
| set_rest | 指定音符を同じ音価・IDの休符へ変更 |
| set_grace_notes | 親noteIdに前置装飾音符列を設定。空配列で解除。各音はpitch・value・slashと任意の運指。既存の子idを指定して保持可能 |
| set_note_expression | noteIdにstaccato／accent／fermata／arpeggioを設定。指定したフィールドだけ変更、nullで解除。accentは`{ velocityRate: 1.5 }`形式で、1.0〜2.0の0.1刻み。前からタイで連結された音符へのaccentの設定・変更は拒否（解除は可能）。fermataは下記参照。フェルマータは楽譜表示・プレビュー再生に反映。アクセントは楽譜表示のみで、演奏ベロシティへの反映は未対応 |
| set_fingering | noteId・pitchIndexに運指／替え指を設定。graceNoteIdを追加すれば装飾音符も対象。fingering=nullで両方解除 |
| set_tie | fromNoteIdからtoNoteIdへの接続。toNoteId=nullで出方向の接続／構築中の接続予定を解除 |
| set_slur | 始点・終点のnoteIdで作成。slurIdを渡すと既存スラーの端点変更 |
| remove_slur | slurIdで解除 |
| set_trill | noteIdの単音タイ連結にsettingsを設定。nullで解除 |
| set_pedal_event／remove_pedal_event | 音符とは独立したpositionにstart/change/stopを設定・解除 |
| set_ottava_event／remove_ottava_event | 独立したposition・staffにstart/stopを設定・解除 |
| set_tempo_change | 上段・声部1のnoteIdにbpmを設定、nullで解除。現モデルのアンカー制限に従う |
| set_clef_change | 対象段・声部1のnoteIdにtreble/bassを設定、nullで解除 |
| set_dynamic_change | 上段・声部1のnoteIdにlevel（ppp／pp／p／mp／mf／f／ff／fff）を設定、nullで解除。変更位置から次の記号まで全声部・両段に共通適用する状態を保存。楽譜表示のみ、演奏ベロシティは未対応 |
| set_initial_values | 初期meter・keyFifths・tempoを設定。既存小節の実長・音符は自動変更しない |
| set_measure_length | measureIdの実長をlength=[分子,分母]へ変更。弱起等に使用 |
| set_key_change | beforeMeasureIdの直前、afterBlockIdの直後、または既存keyChangeIdを指定して設定・更新。3つの指定は排他。keyFifths=nullで対象ブロックを解除 |
| insert_section | beforeMeasureIdの直前、またはafterBlockIdの直後に追加。両指定は排他。末尾の空セクションにも対応 |
| rename_section／remove_section | sectionIdを指定。必須の先頭セクションは削除不可 |

## 対象・時間・参照の規則

- 強弱は`{ type: "set_dynamic_change", noteId: "取得した音符ID", level: "p" }`で設定する。タイの先頭・途中・終端、和音、短い音符、付点、連符に設定可能。他の表現との排他制限はない。休符・装飾音符・下段・声部2以降への設定は拒否する。同時刻に発音する他声部の音も、将来の再生対応時には同じ状態を使う。記号以前の既定状態はmf。現在は再生データ・ベロシティを変更しない。
- 強弱の変更位置は音符IDに追従し、音価・ピッチ変更でも保持する。タイ正規化では変更位置を境界として保存する。音符削除・休符化・声部置換でアンカーがなくなった場合はGUI・MCPとも自動解除し、直前の強弱が有効になる。通常の音符複製・範囲コピーでは変更設定を複製しない。
- 保存形式は`dynamicChanges: [{ noteId, level }]`。`get_score_range`は範囲内の`dynamicChanges`と各小節先頭の`dynamicAtStart`を返し、範囲外の変更から引き継いだ状態も確認できる。MusicXMLには実際の変更位置だけ`direction/dynamics`を出力し、音符・音部記号を書き換えず、`sound dynamics`は出力しない。

- フェルマータは`{ type: "set_note_expression", noteId: "取得した音符ID", fermata: { lengthRatio: 2.0 } }`で設定・変更、`fermata: null`で解除する。倍率は1.0〜4.0の0.1刻み、UI初期値は2.0。プレビュー再生では共通範囲の経過時間を倍率分引き延ばし、全声部・両段の音符・休符・ペダルおよび再生線に共通適用する。範囲外は元の速度で進む。
- 全声部・両段のフェルマータ付き音符区間を比較し、重なるものは絶対的な終了位置が一致する場合だけ許可する。隣接するだけの範囲は重複としない。グループの範囲は最も早い開始から共通終端までとし、倍率は声部番号の小さい順、同じなら上段を優先する。例えば下段の全音符と上段の最後の4分音符なら、全音符の範囲に上段の倍率を採用する。`get_score_range`の`fermataGroups`で有効倍率・優先元・絶対範囲（四分音符単位の分数）を取得できる。
- 音価・付点・絶対的な開始／終了位置が変わった音符のフェルマータは削除する。他ノート・小節の編集で移動した音符も対象。ピッチ変更・和音追加では保持する。MCPで時間編集後に明示的な再設定を同じバッチに置くことは可能だが、確定時にも重複制限を検証する。
- 単音・和音の全音価、付点、連符内の音符に設定可能。休符・装飾音符は対象外。タイ列は終端だけに設定できる。フェルマータ付き音符から後続へタイを追加する場合は、同じバッチでフェルマータを解除するか終端へ移す。

- 小節番号は検索用の1始まり、voiceIndexとpitchIndexは0始まり。編集は取得したIDで行う。
- 普通の音高変更等では音符IDを維持する。声部の全置換では要素IDを再生成し、旧音符の付随表現も置き換わる。音符IDと表現を保持する修正はset_pitches／set_value等を使用する。
- 新しいIDは操作結果のidsまたは同じチェックアウトの範囲取得で得る。必要なら新しい音符を作り、再取得してから関係を設定し、最後にまとめて反映する。
- ペダル・オッターヴァのpositionは`{measureId, offset:{numerator,denominator}}`。四分音符を1とし、1/2は八分音符、1/3は三連符の八分音符。小節先頭は0/1。
- 小節末と次小節先頭が同じ位置なら次小節の0を指定する。譜面の末尾だけ、stopイベントを最終小節長と等しい位置へ置ける。
- ペダルはstart→change*→stop、オッターヴァは段ごとにstart→stop。同じ位置に同種・同段のイベントを重複させない。終端のない開始は現モデルどおり曲末まで有効で、末尾追加時は範囲も延長される。固定したい終端にはstopを置く。
- 音符削除や声部置換でタイ・スラー・トリル・テンポ／音部記号アンカーが不成立になる場合は要求全体を拒否する。解除や端点変更を同じバッチへ明示的に含める。中間の操作間で一時的に参照が切れても、最終候補が成立すればよい。
- set_valueは隣接音符を侵食しないよう自動調整する操作ではない。合計が変わるときは同じバッチで別音符・休符の音価も調整するか、声部全体をreplace_voiceする。
- 分割構築中の未解決タイは作業用状態として保持できるが、finish_checkoutまでに解決・明示解除する。次回チェックアウトへ未解決参照を持ち越さない。

## 小節と声部の入力

基本形は従来と同じ。`{upper:[[...events]],lower:[[...events]],length?:[分子,分母]}`。段省略は全小節休符。指定声部は小節長を過不足なく埋める。音価は全音符～32分音符、付点0–2個。絶対音名の音域はA0–C8で、綴りを現モデルで保持できるものに限る。

連符はactual=2–64、normal=1–64、付点なしbase、events。イベント個数はactualと同じで、書かれた音価の合計がactual個のbase音符に等しい必要がある。この範囲で混合音価・付点音価に対応。入れ子は未対応。

装飾音符等は専門操作で後付けする。初期投入に全表現を詰め込む必要はない。現モデルの制約、例えば装飾音符の親が単音で32分音符以外、トリルが単音または同音のタイ連結、スタッカートとアルペジオが排他等を維持する。トリルの打鍵回数検証はdomainと保存側を2–128へ統一した。

## 取得結果と変更結果

概要は初期設定、番号付きアウトライン、表現件数。範囲取得は小節ごとの有効な調号・テンポ・音部記号、選択声部の生データと時間位置・綴り付きのtimeline、装飾音符、範囲を横断するスラー／トリル、時間イベントと流入状態を含む。

範囲外のタイ・スラー・トリル端点はexternalAnchorsに位置を返す。elementsにある保存形式の音価と、timeline／イベントにある四分音符単位の有理数時間を区別する。UIカーソルは実画面の操作状態で、作業用譜面の独立カーソルを操作するAPIではない。

編集成功応答はchanged・revision・requestId、小節数、構築した音符イベント数、未解決タイ数、changedIds、操作別ids、およびremovedIds・removedNoteAttachments・removedAnchorsを返す。音符の付随表現を含む全置換の影響も確認できる。音符数は和音を1イベントとして数える。

| 上限 | 値 |
| --- | --- |
| 操作／要求 | 64 |
| 新しく作る小節／要求 | 合計32 |
| operationsの正規化UTF-8 JSON | 48 KiB |
| 成功要求／チェックアウト | 64 |
| 小節追加後の曲の小節数 | 512まで。既存の大きな曲の読み取り・局所修正を一律拒否する制限ではない |
| 範囲取得 | 既定4小節、最大8小節、段・声部で絞り込み可 |
| JSON応答 | 200 KiB。超過時は範囲を狭める。超過する編集応答なら候補を公開しない |

内部HTTP64 KiB／応答256 KiB／WebView待ち5秒は維持。上限同士の全組み合わせでの速度保証ではない。

## 対応の維持と検証

操作の単一契約は`score-edit-contract.ts`。実行時検証も同じ定義を使い、`node --experimental-transform-types generate-contract.mjs`でRust向けの`score-operations.schema.json`を生成する。テストで生成物と契約の一致を確認する。

保存モデルの主要フィールドに対するMCP操作対応表fieldCoverageを型チェックする。該当型へフィールドを追加すると対応の判断が必要になる。新しい表現の完成条件は、保存・表示・再生の必要な処理、MCPでの設定・変更・解除、検証・対応表・資料の更新とする。アプリ側にもまだない強弱記号等の新設は個別の設計・実装として進める。

2026-11-10時点：関連33件成功、型チェックはエラー0・既存警告3。全体384件中364成功・20失敗で、失敗名は前回と一致した。Rustテスト5件成功。フロントエンドとMCP debugビルド成功。stdio smokeで11ツールと構築・専門操作のスキーマを確認した。release版のバイナリーはこの作業で更新していない。

Windows開発GUI＋新しいdebug stdio MCPで、空から2小節を構築し、装飾音符・トリル・スラー・スタッカート・アルペジオ・テンポ変更・ペダル・オッターヴァを別要求で設定した。再送重複防止、古いrevisionの拒否、反映後のロックなし読み取りを確認した。

別のMCPプロセスから同じ曲を新たにチェックアウトし、音符IDを維持したC5→C6の変更と3小節目の末尾追加を反映。GUIで装飾・範囲表現と3小節を確認し、Undo1回で再編集前の2小節、2回で構築前の空状態、Redo2回で3小節に戻った。確認用の別GUIで実施し、元のウィンドウを編集していない。最大負荷、全操作の実GUI確認、実際の聴覚による再生確認、release版の通し確認までは含まない。

再現は`node editing-smoke.mjs <実行ファイル> <照合済みの完全なセッションID> create`、完了通知を閉じた後に`... revise`。createは空の確認用セッションだけ、reviseはその2小節の結果だけを対象にする。ユーザーの作業セッションには実行しない。
