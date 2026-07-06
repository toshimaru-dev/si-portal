# 仕事ポータル (work-portal)

VSCode の WebView 拡張として動く、個人用の仕事ポータル。
案件管理・月次処理・目標管理の3機能を、ローカルファイルをデータソースとして扱う。

詳細な設計仕様は [docs/spec.md](docs/spec.md) を参照。

## 機能

- **案件管理**: 案件 → フェーズ → タスクの階層管理（`projects.md`）
- **月次処理**: Outlook エクスポート CSV の取り込み・工数の自動割当・手入力（`hours.csv`）
- **目標管理**: 半期・通期の目標と進捗管理（`goals.md`）

データはワークスペース直下の `.work-portal/` フォルダに Markdown / CSV / JSON として保存される（設定 `workPortal.dataDir` で変更可）。

## インストール

[GitHub Releases](https://github.com/toshimaru-dev/si-portal/releases) から最新の `work-portal-x.y.z.vsix` をダウンロードし、以下のいずれかの方法で VSCode にインストールする。

```bash
code --install-extension work-portal-x.y.z.vsix
```

または VSCode の拡張機能ビュー右上「...」メニューから「VSIXからのインストール...」を選択し、ダウンロードした `.vsix` ファイルを指定する。

## セットアップ（開発用）

```bash
npm install
```

## 開発

```bash
npm run watch        # esbuild をウォッチビルド
npm run check-types   # 型チェック
```

VSCode で本フォルダを開き、`F5` で拡張をデバッグ実行する。

## ビルド

```bash
npm run compile
```

## コマンド

- `仕事ポータルを開く` (`workPortal.open`)
