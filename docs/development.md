# 開発手順

## セットアップ

```bash
npm install
```

## 開発

```bash
npm run watch        # esbuild をウォッチビルド
npm run check-types  # 型チェック
```

VSCode で本フォルダを開き、`F5` で拡張をデバッグ実行する。

## ビルド

```bash
npm run compile
```

## パッケージング（VSIX生成）

```bash
npx vsce package
```
