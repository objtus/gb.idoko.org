# ゲストブック実装プロジェクト まとめ

## 概要

idoko.org / yuinoid.neocities.org 向けのゲストブックを実装した。
バックエンドはCloudflare Pages Functions + D1（SQLite互換）。
スパム対策にCloudflare Turnstileを使用。

---

## サイト構成

| ドメイン | ホスティング | 用途 |
|---|---|---|
| `yuinoid.neocities.org` | Neocities | 個人サイト本体 |
| `idoko.org` | Cloudflare Pages | いど子のホームページ（シンプルなページ） |
| `gb.idoko.org` | Cloudflare Pages | ゲストブック本体 |

---

## GitHubリポジトリ

| リポジトリ | URL | 用途 |
|---|---|---|
| idoko.org本体 | `https://github.com/objtus/idoko.org` | idoko.orgのホスティング |
| ゲストブック | `https://github.com/objtus/gb.idoko.org` | gb.idoko.orgのホスティング |

---

## Cloudflareプロジェクト

### Pagesプロジェクト

| プロジェクト名 | カスタムドメイン | GitHubリポジトリ |
|---|---|---|
| `idoko-org` | `idoko.org` | `objtus/idoko.org` |
| `idoko-gb` | `gb.idoko.org` | `objtus/gb.idoko.org` |

### D1データベース

- **名前**: `idoko-guestbook`
- **ID**: `e6c0ddc1-51c6-4d38-8d83-4f996eed4751`
- **リージョン**: APAC
- **バインディング変数名**: `idoko_guestbook`

#### テーブル構造（commentsテーブル）

```sql
CREATE TABLE comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  message      TEXT NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  subject      TEXT,
  reply_to_id  INTEGER REFERENCES comments(id),
  poster_id    TEXT
);

CREATE TABLE gb_rate_limit (
  ip           TEXT PRIMARY KEY,
  last_post_unix INTEGER NOT NULL
);

-- 1 投稿が複数の親（返信先）を持ち得る。comments.reply_to_id は代表親（並びの先頭）と同期
CREATE TABLE comment_reply_targets (
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comment_id, target_id)
);
```

複数親の DDL・バックフィルは **[migrations/0002_comment_reply_targets.sql](d:\web\gb.idoko.org\migrations\0002_comment_reply_targets.sql)**。初回のみ（ローカル／本番それぞれ）:

```powershell
npx wrangler d1 execute idoko-guestbook --local  --file=migrations/0002_comment_reply_targets.sql
npx wrangler d1 execute idoko-guestbook --remote --file=migrations/0002_comment_reply_targets.sql
```

- **推奨順序**: 複数親機能を使う **Workers（Pages）を本番に載せる前後**に、この SQL を **ローカルおよび本番それぞれで 1 回**流す。マイグレーションが未適用だと `comment_reply_targets` への INSERT が失敗する（コード側ではログのみで握りつぶすため、**複数親が保存されない**ことがある）。
- **リモート実行時**: Wrangler が確認を出し、**短時間 D1 がクエリ処理できない**状態になることがある。失敗した場合はメッセージどおり **そのまま再実行してよい**（未完了なら元に戻る）。
- **冪等性**: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `INSERT OR IGNORE` により、同じファイルを **誤って再実行しても致命的にはなりにくい**。
- **動作確認の例**（リモート）:

```powershell
npx wrangler d1 execute idoko-guestbook --remote --command "SELECT COUNT(*) AS n FROM comment_reply_targets;"
```

本文に **行単体が `>>(数字)` になる行頭参照**があると、その番号も返信先にマージされる（`/api/comments` POST でサーバが解決）。インラインの `テスト>>12テスト` は無視される。

※ `subject`、`reply_to_id`、`poster_id` は過去 migration で追加。`comment_reply_targets` は上記ファイル。

#### D1 データのリセット（ローカル／リモート）

**警告**: `--remote` は本番の **`idoko-guestbook`** に効く。実行前に本当にまっさらでよいか確認する（復元にはバックアップが別途必要）。

削除の要点は次のとおり。

1. **`comment_reply_targets` を先に削除**する（親子の番号だけを残す参照が消える）。
2. **`comments` は `reply_to_id` で自己参照**しているため、環境によっては `DELETE FROM comments` の一括が **外部キーで失敗**することがある。その場合は、**だれにも「返信先」として指されていない行（リーフ）から順に削除**する。リポジトリでは **[migrations/dev_reset_d1_data.sql](d:\web\gb.idoko.org\migrations\dev_reset_d1_data.sql)** に、リーフ削除を繰り返したあと `gb_rate_limit` と **`sqlite_sequence`（comments の自動採番カウンター）**を消す手順をまとめてある。
3. **`DELETE FROM comments` だけでは `AUTOINCREMENT` がリセットされない**。上記ファイル末尾の **`DELETE FROM sqlite_sequence WHERE name = 'comments';`** で、ローカルで「次の INSERT は `id` が 1 から」になりやすくする（その行だけ省けばカウンターはそのまま）。採番を残したまま行だけ消す用途では `sqlite_sequence` の行をコメントアウトするなどして調整する。

ローカルで実行する例:

```powershell
cd D:\web\gb.idoko.org
npx wrangler d1 execute idoko-guestbook --local --file=migrations/dev_reset_d1_data.sql
```

リモート（本番）で同じことをする場合は **`--remote`** にだけ差し替える。返信チェーンが **20 を超える深さ**なら、`dev_reset_d1_data.sql` 内の `DELETE FROM comments WHERE id NOT IN (...)` 行を同じ文言で増やす。

単純に件数だけ確認するとき:

```powershell
npx wrangler d1 execute idoko-guestbook --local --command "SELECT (SELECT COUNT(*) FROM comments) AS comments, (SELECT COUNT(*) FROM comment_reply_targets) AS targets, (SELECT COUNT(*) FROM gb_rate_limit) AS rate_limit;"
```

#### ダミーデータで返信を試す（例）

ダミーを入れるときは **`reply_to_id` が参照する親の `id` が実在する**ことが必要。**採番をリセットしていないと**、親が `id=1` ではなくなるため、`reply_to_id = 1` の INSERT は **`FOREIGN KEY` で失敗**する。親の実 ID は次で確認する。

```powershell
npx wrangler d1 execute idoko-guestbook --local --command "SELECT id, name, reply_to_id FROM comments ORDER BY id;"
```

**既存の `#3` への返信**（1 回の実行で `comment_reply_targets` も付与）:

```powershell
npx wrangler d1 execute idoko-guestbook --local --command "INSERT INTO comments (name, message, reply_to_id) VALUES ('ダミー', '#3 への返信', 3); INSERT OR IGNORE INTO comment_reply_targets (comment_id, target_id, position) SELECT last_insert_rowid(), 3, 0;"
```

本番／リモート D1 で同様に試すときは、`--remote` とし、親の **`id`** を実データに合わせて **`3` を置き換える**。

### Turnstile

- **サイトキー**: `0x4AAAAAADIZD04CPzXtviYs`
- **シークレットキー**: 環境変数 `TURNSTILE_SECRET` に設定済み
- **登録ドメイン**: `gb.idoko.org`、`yuinoid.neocities.org`

### 環境変数（idoko-gbプロジェクト）

| 変数名 | 内容 |
|---|---|
| `TURNSTILE_SECRET` | TurnstileのSecret Key |

### バインディング（idoko-gbプロジェクト）

| 変数名 | タイプ | データベース名 |
|---|---|---|
| `idoko_guestbook` | D1 | `idoko-guestbook` |

---

## gb.idoko.orgリポジトリの構成

```
gb.idoko.org/
├── index.html                  ← ゲストブックUI（Cursor生成、リッチ版）
├── migrations/                 ← D1 手動適用用 SQL（複数親・データリセット用など）
├── functions/
│   ├── api/
│   │   ├── comments.js         ← GET/POST API（Cursor生成）
│   │   └── guestbook-rss.js    ← RSS配信（Cursor生成）
├── plan.md                     ← Cursorが生成した設計メモ
└── wrangler.toml
```

### wrangler.toml（gb.idoko.org）

```toml
name = "idoko-gb"
compatibility_date = "2024-01-01"
pages_build_output_dir = "."

[[d1_databases]]
binding = "idoko_guestbook"
database_name = "idoko-guestbook"
database_id = "e6c0ddc1-51c6-4d38-8d83-4f996eed4751"
```

---

## ローカル開発（Wrangler）

リポジトリ直下（`wrangler.toml` があるディレクトリ）で作業する。

### Pages + Functions を起動する

```powershell
cd D:\web\gb.idoko.org
npx wrangler pages dev .
```

- 既定で **`http://127.0.0.1:8788`** が開く（表示が出た URL に合わせる）。
- ポートを変える例: `npx wrangler pages dev . --port 8791`
- 一覧 UI は **`/api/comments`** を同一オリジンで読むので、このサーバー経由で開くと **ローカル D1 + ローカル Functions** がそのまま使われる。
- ブラウザは **`http://`** で開く（`https://127.0.0.1:...` は使わない）。
- ターミナルを閉じたあとブラウザが **`8788` に繋がらない／読み込みだけ続ける**ときは、`netstat -ano | findstr ":8788"` で **`LISTENING` の末尾の PID 番号**を控え、`taskkill /PID その番号 /F` で終了させてから `pages dev` を再度起動する。

### 環境変数（ローカル）

Turnstile 付き POST まで試す場合など、プロジェクト直下に **`.dev.vars`** を置く（[Wrangler のドキュメント](https://developers.cloudflare.com/pages/functions/bindings/#interact-with-your-configuration-locally)参照）。**`.dev.vars` はリポジトリの `.gitignore` に含まれている**（秘密をコミットしないこと）。

例:

```env
TURNSTILE_SECRET=（シークレットキー）
```

### ローカル D1

- **`--remote` は付けない**。付けると **本番側の `idoko-guestbook`** に対して実行される。
- ローカル DB の実体は、通常 **`.wrangler/state/v3/d1`** 以下（Wrangler が管理）。
- DB 論理名は **`idoko-guestbook`**（`wrangler.toml` の `database_name` と一致）。

初回のみ、テーブルが無ければ一覧 API がエラーになる。PowerShell で例:

```powershell
cd D:\web\gb.idoko.org
npx wrangler d1 execute idoko-guestbook --local --command "CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, message TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, subject TEXT, reply_to_id INTEGER REFERENCES comments(id), poster_id TEXT);"
npx wrangler d1 execute idoko-guestbook --local --command "CREATE TABLE IF NOT EXISTS gb_rate_limit (ip TEXT PRIMARY KEY, last_post_unix INTEGER NOT NULL);"
```

複数返信先テーブルまで使う場合は、続けて（[D1 の `0002` と同じファイル](d:\web\gb.idoko.org\migrations\0002_comment_reply_targets.sql)）:

```powershell
npx wrangler d1 execute idoko-guestbook --local --file=migrations/0002_comment_reply_targets.sql
```

```powershell
npx wrangler d1 execute idoko-guestbook --local --command "SELECT id, name, message FROM comments ORDER BY id DESC LIMIT 10;"
```

### ローカルでの確認ポイント

| 確認したいこと | URL の例 |
|---|---|
| トップ一覧 | `http://127.0.0.1:8788/` |
| API（クエリつき） | `http://127.0.0.1:8788/api/comments?page=1` |
| 個別ページ | `http://127.0.0.1:8788/guestbook/001` |
| RSS | `http://127.0.0.1:8788/api/guestbook-rss` |

- 一覧のページネーションは **1 ページあたりの件数が閾値を超えると**表示される（既定では **25 件／ページ**。少ないデータで見たい場合は `/?limit=2` のように **URL の `limit`（1〜100）** でページサイズを下げられる）。

---

## APIエンドポイント

| エンドポイント | メソッド | 内容 |
|---|---|---|
| `https://gb.idoko.org/api/comments` | GET | コメント一覧取得 |
| `https://gb.idoko.org/api/comments` | POST | コメント投稿 |
| `https://gb.idoko.org/api/guestbook-rss` | GET | RSS配信 |

### GETレスポンス形式

```json
{
  "comments": [
    {
      "id": 1,
      "name": "name",
      "subject": null,
      "message": "test",
      "created_at": "2026-05-03 13:22:14",
      "reply_to_id": null,
      "reply_target_ids": [],
      "poster_id": "legacy-1",
      "display_name": "name",
      "is_admin": false
    }
  ],
  "max_id": 1
}
```

複数返信先がある場合は **`reply_target_ids`** に順序付きで含まれる（`reply_to_id` は先頭と同期した代表値）。

### POSTリクエスト形式

```json
{
  "name": "任意",
  "subject": "任意",
  "message": "必須",
  "turnstileToken": "必須",
  "website": "ハニーポット（空であること）",
  "reply_to_id": "任意、返信先ID"
}
```

---

## Neocities側（未完了）

- `yuinoid.neocities.org/guestbook/index.html` にゲストブックページを設置予定
- APIは `https://gb.idoko.org/api/comments` をfetchで使用
- Turnstileのドメインに `yuinoid.neocities.org` は登録済み
- HTMLはまだアップロードしていない

---

## スパムコメントの手動削除方法

Cloudflareダッシュボード → **Storage & Databases** → **D1** → `idoko-guestbook` → **コンソール**

```sql
-- 一覧確認
SELECT id, name, message, created_at FROM comments ORDER BY created_at DESC;

-- 削除
DELETE FROM comments WHERE id = 123;
```

---

## 備考・経緯

- 当初 `idoko.org` リポジトリにゲストブックを同居させていたが、`_redirects` でサブドメイン別ルーティングができないCloudflare Pagesの制約により、`gb.idoko.org` を独立したリポジトリ・Pagesプロジェクトに分離した
- HTMLとAPIの一部はCursorが生成したリッチ版（返信機能、プレビュー、subject欄、RSSフィード、ポスターIDフィルター）を採用
- フォントはNeocitiesサイトのデザイン（saitamaar、UDEV Gothic）に合わせたスタイルを適用