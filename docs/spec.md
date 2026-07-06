# 仕事ポータル拡張 — 設計仕様 (SPEC.md)

VSCode の WebView 拡張として動く、個人用の仕事ポータル。
案件管理・月次処理・目標管理の3機能を、ローカルファイルをデータソースとして扱う。

---

## 1. 全体アーキテクチャ

```
ローカルファイル  <—read/write—>  拡張ホスト (extension.ts)  <—postMessage—>  WebView (SPA)
    .work-portal/                  ドメイン別データ層 + 監視              ダッシュボード + 3ビュー
```

- WebView は直接ファイルにアクセスしない。ファイル I/O は必ず拡張ホスト側で行い、結果を `postMessage` で WebView に渡す。
- 拡張ホストはドメイン (`projects` / `hours` / `goals`) ごとに `read()` / `write()` を持つ薄いデータ層と、`FileSystemWatcher` によるファイル監視を持つ。
- WebView は単一の SPA。トップのダッシュボード + 3タブ (案件 / 月次 / 目標) を切り替える。
- 状態の真実はファイル。WebView は作業中コピーをメモリに持ち、保存はメッセージ経由でホストに依頼する。UI の一時状態のみ `vscode.getState/setState` を使う（localStorage は使用不可）。

### データ配置

- 設定 `workPortal.dataDir` でデータフォルダを指定。既定はワークスペース直下の `.work-portal/`。
- ファイル一覧:
  - `projects.md` … 案件管理（Markdown形式）
  - `hours.csv` … 月次処理（工数データ）
  - `hours-mapping.json` … 月次処理（Outlook 件名 → 案件 の割当ルール）
  - `goals.md` … 目標管理（Markdown形式）

---

## 2. データ設計

### 2.1 案件管理 — `projects.md`

案件 → フェーズ → タスクの入れ子構造を Markdown の見出し・箇条書きで表現する（JSONではなくMarkdownを正のデータソースとする。手編集のしやすさを優先した設計判断）。

```markdown
# ABC社 認証基盤更改 {#prj-001}
- client: ABC社
- status: active
- createdAt: 2026-07-01T00:00:00+09:00
- updatedAt: 2026-07-05T00:00:00+09:00

## 要件定義 (doing) {#ph-001}
- [x] ヒアリング実施 (due: 2026-07-10) {#t-001}
- [ ] ヒアリングシート整理 (due: 2026-07-18, doing) {#t-002}
    note: 対象部署をリストアップ済み

## 設計 (todo) {#ph-002}
```

- `#` = 案件見出し、`##` = フェーズ見出し（`(status)` を末尾に付与）、`- [ ]`/`- [x]` = タスク（チェック済み = `done`）。
- `{#id}` で各要素の一意IDを保持する（`prj-` / `ph-` / `t-` 接頭辞）。`hours.csv` の `projectId` 等、他ファイルから参照されるため安定させる必要がある。
- タスク行の `(...)` には `due: YYYY-MM-DD` と、`doing` 状態のときのみ `doing` トークンを入れる（チェック無し＋`doing`指定なし = `todo`、チェック無し＋`doing`指定 = `doing`、チェック済み = `done`）。
- タスク直後にインデントされた `note: ...` 行があれば備考として扱う。
- `status` (project): `active` | `onhold` | `closed`
- `status` (phase/task): `todo` | `doing` | `done`
- `{#id}` を省略して手書きした場合、読み込み時にホストがIDを自動採番し、ファイルへ書き戻して以後安定させる。
- **この構文（見出し・箇条書き・`{#id}`）に沿わない自由記述は保存時に失われる**ため、生成ファイル先頭に注意書きコメントを入れる。JSON Schemaのような手編集支援は効かないため、構文はシンプルに保つ。

### 2.2 月次処理 — `hours.csv`

`年月 × 案件 × 工数` の表形式。Excel でも開けるよう CSV。1行 = 「ある年月・ある案件・ある由来」の集計工数。

| 列 | 説明 |
|----|------|
| `年月` | `YYYY-MM` |
| `projectId` | `projects.md` の案件 id。未割当は `unassigned` |
| `案件名` | 表示用（`projectId` から導出。可読性のため冗長に保持） |
| `工数h` | 工数（時間、小数可） |
| `source` | `outlook` \| `manual` |
| `備考` | 任意 |

- 1行の粒度は `(年月, projectId, source)` の集計値。
- `source` により Outlook 取り込み分と手入力分を区別する（後述の再取り込みで手入力を保護するため）。

### 2.3 月次処理 — `hours-mapping.json`

Outlook イベントの件名 → 案件 の割当ルール。**配列の順に照合し、最初にヒットしたルールを採用**（＝優先度は並び順）。

```json
{
  "rules": [
    { "keyword": "ABC社", "projectId": "prj-001" },
    { "keyword": "定例", "projectId": "prj-002" }
  ],
  "matchMode": "contains",
  "caseSensitive": false
}
```

- `matchMode`: `contains`（部分一致）を既定とする。
- どのルールにもヒットしないイベントは `unassigned` として取り込み、UI 上で手動割当する。
- 手動割当の際に「この件名を今後この案件へ」を選ぶと、`rules` に新しいルールを追記する（学習）。

### 2.4 目標管理 — `goals.md`

半期・通期の人事目標と進捗を Markdown で表現する（`projects.md` と同様、Markdownを正のデータソースとする）。

```markdown
# セキュリティ製品の提案力強化 {#g-001}
- category: 技術力向上
- type: half
- fiscalYear: 2026
- half: H1
- progress: 40
- updatedAt: 2026-07-05T00:00:00+09:00

- [x] 候補製品リスト作成
- [ ] 提案テンプレ整備

テンプレ整備は完了。展開フェーズに移行中。
```

- `#` = 目標見出し（`{#id}` で一意ID、`g-` 接頭辞）。
- 見出し直下の `- key: value` がメタデータ（`category`: 自由記述のカテゴリ名（ユーザーがMarkdown上で自由に登録・命名する。固定の選択肢ではない）、`type`: `half`|`full`、`fiscalYear`、`half`: `H1`|`H2`（`type: half` のときのみ）、`progress`: 0–100の整数、`updatedAt`）。ポータルの目標管理画面では、既存の目標に付いている `category` の値からカテゴリ一覧を自動抽出してフィルタピルを表示する（カテゴリの追加・命名自体はMarkdown編集で行う）。
- `- [ ]`/`- [x]` の箇条書きがマイルストーン（チェック済み = `done`）。他ファイルから参照されないため `{#id}` は不要。
- マイルストーンの後、次の見出しまでの自由記述行がメモ（`note`）。複数行可。
- `{#id}` を省略して手書きした場合は `projects.md` と同様に自動採番して書き戻す。
- この構文に沿わない記述は保存時に失われる点も `projects.md` と同様。

---

## 3. 機能仕様

操作モデルは機能ごとに分ける（全機能を同じ編集 UI にはしない）。

### 3.1 ダッシュボード（トップ）

3機能を横断するサマリを3カードで表示。各カードから該当タブへ遷移。

- 案件カード: 進行中案件数、期限超過／直近期限のタスク一覧（上位数件）。
- 月次カード: 今月の総工数、案件別内訳のミニ棒グラフ。
- 目標カード: 各目標の進捗バー（%）。

### 3.2 案件管理（フル編集）

- 案件／フェーズ／タスクの追加・編集・削除。
- タスクの状態変更（`todo`/`doing`/`done`）、期限設定。
- フェーズ単位の進捗（配下タスクの done 比率）を表示。
- 変更は `projects.md` に保存。

### 3.3 月次処理（取り込み + 手入力 + 割当）

取り込みフロー:

1. Outlook のエクスポート CSV を選択（ファイル選択、またはドラッグ）。
2. 各イベントの `開始日時`〜`終了日時` から工数を自動計算。日本語ヘッダ（`件名`/`開始日`/`開始時刻`/`終了日`/`終了時刻`）・英語ヘッダ（`Subject`/`Start Date`/...）の両方に対応。
3. `hours-mapping.json` のルールで件名を照合し、案件を自動割当。
4. 未割当イベントは画面上で案件を手動選択（任意でルール追加）。
5. 確定 → 年月×案件で集計し、`hours.csv` の該当月の `source=outlook` 行を差し替え。

補足:

- **再取り込みはその月の `outlook` 行だけを差し替える**（二重計上防止）。`manual` 行は常に保持。
- 手入力: 年月・案件・工数・備考を直接追加／編集（`source=manual`）。
- 表示: 月別／案件別の集計、案件別内訳グラフ。

### 3.4 目標管理（進捗更新中心）

- 目標の追加・編集。
- 進捗 % の更新（数値入力）、マイルストーンのチェック、メモ更新。進捗バーは表示専用。
- 半期／通期でのフィルタ表示。閲覧寄りの軽い編集。

---

## 4. 入力方式

原則としてデータ入力はポータルの UI（ボタン・フォーム・取り込み機能）から行う。CSV / Markdown はあくまで保存形式。ただし VSCode 拡張の利点を活かし、**直接編集を常時併用可能**とする。

### 4.1 直接編集の快適化

- `projects.md` / `goals.md` は Markdown 形式のため JSON Schema のような手編集支援は効かないが、その分構文をシンプルにし（§2.1, §2.4）、VSCode の Markdown 表示（見出し・チェックボックスの視認性）で手編集しやすくしている。`{#id}` を省略して手書きしても読み込み時に自動採番して書き戻すため、IDを意識せず書き始められる。
- ポータルに「Markdownを編集」ボタンを置き、`vscode.window.showTextDocument(uri, { viewColumn: Beside })` で対象ファイルを横に開く。保存すると `FileSystemWatcher` がポータルを即再描画し、「左で編集 → 右で結果が即反映」のループになる。

### 4.2 機能別の入力手段

- **案件管理**: 状態変更（`todo`↔`doing`↔`done`）のクリック、案件／フェーズ／タスクの追加・削除はポータルUIで行う（新規案件は標準フェーズ「要件定義/設計/実装/テスト」を自動作成）。名称変更・クライアント変更・備考編集など細かな修正は「Markdownを編集」ボタンで `projects.md` を開く方式で省コストに。
- **月次処理**: 主役は Outlook CSV の取り込みと手入力用の小フォーム。取り込みフロー自体が入力 UI になる。CSV を直接手編集する運用は基本想定しない。
- **目標管理**: 進捗 % はポータル上の数値入力（進捗バーは表示専用）。それ以外は「Markdownを編集」で `goals.md` を開く方式で十分。

### 4.3 MVP 方針

- 初期は「直接編集（`projects.md` / `goals.md` ともにMarkdown）＋ ポータルは表示・集計・取り込み担当」で始める。
- 頻度が高く実装が軽い操作（状態のクリック変更、進捗%の数値入力）だけ先にポータル側へ持たせる。
- フォームの作り込みは、実際に使って面倒だと感じた操作にのみ後付けする。

---

## 5. メッセージプロトコル（host ↔ webview）

`{ type, domain?, payload? }` 形式。

WebView → ホスト:

- `{ type: "requestData", domain }` … 初期表示・再読込
- `{ type: "save", domain, payload }` … ドメインデータの保存
- `{ type: "importOutlook", payload: { csvText } }` … Outlook CSV 取り込み
- `{ type: "assign", payload: { eventKey, projectId, addRule } }` … 未割当の手動割当

ホスト → WebView:

- `{ type: "data", domain, payload }` … 読み込んだデータ
- `{ type: "importResult", payload: { assigned, unassigned } }` … 取り込みプレビュー
- `{ type: "saved", domain }` … 保存完了
- `{ type: "fileChanged", domain }` … 監視で外部変更を検知（再読込を促す）
- `{ type: "error", message }` … エラー

---

## 6. 技術メモ

- WebView オプション: `enableScripts: true`、`localResourceRoots`（アセット用）、`retainContextWhenHidden: true`。
- アセット（画像・CSS）は `webview.asWebviewUri()` で変換した URI を使い、CSP は nonce 方式。
- テーマ追従: 色は VSCode のテーマ変数（`--vscode-*` の CSS 変数）を使い、ライト／ダーク双方に自動対応。
- ファイル読み書きは `vscode.workspace.fs`（リモート／Web でも動く）。
- CSV パース／生成は軽量に自前実装 or 小さなライブラリ。工数計算は分単位で丸め方針を決める（既定: 0.25h 単位）。
- 日付・タイムゾーンは JST 前提。

---

## 7. 実装の進め方（段階）

- **v0 スケルトン**: 拡張起動 → コマンドで WebView を開く → `projects.md` を読み込み → ダッシュボードに件数表示まで。host↔webview のメッセージ往復を確立。
- **v1 案件管理**: `projects.md` のフル編集。
- **v2 月次処理**: Outlook CSV 取り込み（件名キーワード割当）＋手入力＋ `hours.csv` 保存。
- **v3 目標管理**: `goals.md` の進捗更新。
- **v4 ダッシュボード強化**: 横断集計とグラフ、`FileSystemWatcher` による自動更新。
