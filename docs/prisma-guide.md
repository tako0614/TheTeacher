# Prisma ガイド

`data-model.md` で定義しているリレーショナルデータを Prisma で管理する方針。スキーマとマイグレーションを 1 か所にまとめ、アプリ（Tauri 側の SQLite）と API（Cloudflare Workers + D1 予定）で共有する。

## 配置と前提
- スキーマ: `packages/shared/prisma/schema.prisma`
- マイグレーション: `packages/shared/prisma/migrations/`
- ローカル DB（開発用 SQLite）: `packages/shared/prisma/dev.db`
- 環境変数例: `DATABASE_URL="file:./packages/shared/prisma/dev.db"` をリポジトリ直下の `.env.local` などに置く（コミットしない）
- Prisma のバージョンは workspace ルートで固定する（`-w` オプションでインストール）

## 依存関係の追加
1. Prisma 本体（開発依存）: `pnpm add -D prisma -w`
2. クエリを実行するパッケージごとに `@prisma/client` を追加する（例では API のみ）
   - API（Workers）側: `pnpm add @prisma/client @prisma/adapter-d1 --filter @theteacher/api`
   - 他のランタイムで使う場合も同様に `@prisma/client` を追加し、実行環境から参照できる `DATABASE_URL` を設定する（Tauri の場合は Rust コマンド/sidecar 経由で実行する想定）

## スキーマ更新〜マイグレーション作成（SQLite 開発用）
1. `packages/shared/prisma/schema.prisma` を編集し、`data-model.md` と整合性を取る
2. フォーマット: `pnpm dlx prisma format --schema packages/shared/prisma/schema.prisma`
3. マイグレーション生成:  
   `pnpm dlx prisma migrate dev --schema packages/shared/prisma/schema.prisma --name <change-name>`
   - `dev.db` が自動更新される
   - 生成された `migrations/` と `schema.prisma` をコミットする
4. クライアント生成（必要なパッケージで実行）:  
   `pnpm dlx prisma generate --schema packages/shared/prisma/schema.prisma --generator client`

## 本番適用（SQLite/他 RDB の場合）
- CI/配布時は `pnpm dlx prisma migrate deploy --schema packages/shared/prisma/schema.prisma` を使用し、既存マイグレーションを順に適用する
- テスト用に別 DB を使う場合は `DATABASE_URL` を `file:./packages/shared/prisma/test.db` などに切り替えて同じコマンドを実行

## Cloudflare D1 で使う場合（予定）
D1 は `prisma migrate dev` を直接当てられないため、SQL スクリプトを生成して Wrangler で適用する。

1. 初回（初期化）の SQL を作る:  
   `pnpm dlx prisma migrate diff --from-empty --to-schema-datamodel packages/shared/prisma/schema.prisma --script > services/api/prisma/migrations/0001_init.sql`
2. 2 回目以降（差分）の SQL を作る:  
   `pnpm dlx prisma migrate diff --from-migrations packages/shared/prisma/migrations --to-schema-datamodel packages/shared/prisma/schema.prisma --script > services/api/prisma/migrations/<timestamp>_<name>.sql`
3. ローカル D1 に適用: `pnpm wrangler d1 migrations apply <DB_NAME> --local`
4. 本番適用: `pnpm wrangler d1 migrations apply <DB_NAME>`
5. Worker ランタイムでの接続例:
   ```ts
   import { PrismaClient } from '@prisma/client';
   import { PrismaD1 } from '@prisma/adapter-d1';

   export default {
     fetch(request: Request, env: { DB: D1Database }) {
       const adapter = new PrismaD1(env.DB);
       const prisma = new PrismaClient({ adapter });
       // ...handler...
     },
   };
   ```

## 運用ルール
- マイグレーションは 1 変更 1 ファイルで小さく分割する
- `schema.prisma` と `migrations/` を必ずセットでレビュー/コミットする
- 実データを壊さないよう、破壊的変更が必要な場合はバックアップ手順を PR に併記する
- `.env*` に書くシークレットや接続文字列はコミットしない（`.gitignore` の対象）
