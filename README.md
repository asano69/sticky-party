# WXT + SolidJS

This template should help get you started developing with SolidJS in WXT.


```sh
pnpm dlx wxt@latest init my-extension
pnpm install
pnpm dev:firefox
```

開発が終わったら `pnpm build:firefox` でFirefox向け（Manifest V2）のビルドを生成し、`pnpm zip:firefox` でaddons.mozilla.org提出用のzipを作成します。Firefoxはデフォルトで MV2 が使われますが、`--mv3` フラグでMV3も指定できます。
