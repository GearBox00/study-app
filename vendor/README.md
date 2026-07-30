# vendor（外部ライブラリ）

オフラインでも動くよう、外部から読み込まずにこのフォルダへ同梱しています。
中身は改変していません。

| ファイル | 用途 | 配布元 | ライセンス |
| --- | --- | --- | --- |
| `jsqr.js` | カメラ映像からQRコードを読み取る | jsQR 1.4.0 (cozmo/jsQR) | Apache License 2.0（`jsqr-LICENSE.txt`） |
| `qrcode.js` | 拠点に掲示するQRコードを作る | qrcode-generator 1.4.4 (Kazuhiko Arase) | MIT License（ファイル冒頭に記載） |

更新するときは配布元から取得し直し、`sw.js` の `CACHE` の版番号を上げてください。
