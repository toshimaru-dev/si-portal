# 仕事ポータル (work-portal)

VSCode の WebView 拡張として動く、個人用の仕事ポータル。
案件管理・月次処理・目標管理の3機能を、ローカルファイルをデータソースとして扱う。

詳細な設計仕様は [docs/spec.md](docs/spec.md) を参照。

## 機能

- **案件管理**: 案件 → フェーズ → タスクの階層管理（`projects.md`）
- **月次処理**: Outlook エクスポート CSV の取り込み・工数の自動割当・手入力（`hours.csv` / `hours-daily.csv`）
- **目標管理**: 半期・通期の目標と進捗管理（`goals.md`）

データはワークスペース直下の `.work-portal/` フォルダに Markdown / CSV / JSON として保存される（設定 `workPortal.dataDir` で変更可）。

## インストール

[GitHub Releases](https://github.com/toshimaru-dev/si-portal/releases) から最新の `work-portal-x.y.z.vsix` をダウンロードし、以下のいずれかの方法で VSCode にインストールする。

```bash
code --install-extension work-portal-x.y.z.vsix
```

または VSCode の拡張機能ビュー右上「...」メニューから「VSIXからのインストール...」を選択し、ダウンロードした `.vsix` ファイルを指定する。

## コマンド

- `仕事ポータルを開く` (`workPortal.open`)：コマンドパレットまたはアクティビティバーのアイコンからポータルを開く。

## 初回導入手順

拡張を初めて有効化したワークスペースでは、各ビューに対応するデータファイルはまだ存在しない。ポータルを開くと `.work-portal/` フォルダ（および `projects.md` / `goals.md`）は自動生成されるが、中身は空の状態から始まる。ビューごとの初回投入方法は以下の通り。

### 案件管理

- 初回は案件が0件の状態。画面左上の「+ 新規案件」から追加するか、「Markdownを編集」ボタンで `projects.md` を直接編集して案件を書き込む。
- `projects.md` の記法（`#`/`##`/`- [ ]` と `{#id}` の扱い）は [docs/spec.md §2.1](docs/spec.md#21-案件管理--projectsmd) を参照。

### 月次処理

- 初回は工数データが0件の状態。次のいずれかで投入する。
  - **Outlook CSV 取り込み**：「Outlook CSV 取り込み」ボタンからエクスポート済み CSV を選択する。動作確認用のサンプルとして [`samples/outlook-export-sample.csv`](samples/outlook-export-sample.csv) を同梱しているので、まず取り込みフローを試す際に利用できる（日本語ヘッダ `件名`/`開始日`/`開始時刻`/`終了日`/`終了時刻`、英語ヘッダ `Subject`/`Start Date`/... の両方に対応）。
  - **手入力**：年月・案件・工数を直接フォームから追加する。
- 取り込んだイベントの案件割当は画面上のクライアント→案件の2段階プルダウンで行う。詳細は [docs/spec.md §3.3](docs/spec.md#33-月次処理取り込み--手入力--割当) を参照。

### 目標管理

- 初回は目標が0件の状態。「Markdownを編集」ボタンから `goals.md` を開き、目標を追記する（ポータルUI上に新規追加ボタンはなく、直接編集が入力手段）。
- `goals.md` の記法は [docs/spec.md §2.4](docs/spec.md#24-目標管理--goalsmd) を参照。

## 開発

開発環境のセットアップ・ビルド手順は [docs/development.md](docs/development.md) を参照。
