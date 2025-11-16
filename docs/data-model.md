# データモデル詳細（ドラフト）

Phase 0 での実装を前提に、ローカル（Tauri 側）を主としたテーブル/コレクション設計。後続で Workers 側に同期する場合は `cloud_*` を追加する。

## 共通ポリシー
- ID は UUID v4 前提。
- タイムスタンプは ISO8601 文字列（UTC）で保持。
- JSON フィールドはアプリ側で型安全に扱う前提（`packages/shared` に型/スキーマを置く）。

## ローカル永続化（SQLite または IndexedDB 想定）

### learning
- `id`: TEXT PK
- `title`: TEXT not null
- `subject`: TEXT nullable（教科プリセット名）
- `tags`: TEXT[]（タグ文字列配列、SQLite の場合は JSON）
- `progress`: REAL nullable（正答率などの集計値）
- `created_at`: TEXT not null
- `updated_at`: TEXT not null
- Index: `subject`, `created_at desc`, `updated_at desc`, `json_each(tags)`

### material
- `id`: TEXT PK
- `learning_id`: TEXT FK -> learning.id
- `type`: TEXT not null（`text` | `pdf` | `image` | `audio` | `video` | `url`）
- `source_path`: TEXT nullable（ローカルパスまたは URL）
- `raw_content`: TEXT nullable（抽出テキスト/文字起こし）
- `metadata`: JSON nullable（size, pages, duration, filename, mime など）
- `created_at`: TEXT not null
- `updated_at`: TEXT not null
- Index: `learning_id`, `type`

### generated_content
- `id`: TEXT PK
- `learning_id`: TEXT FK -> learning.id
- `material_id`: TEXT nullable（生成元教材が特定できる場合のみ）
- `type`: TEXT not null（`qa` | `practice` | `summary` | `podcast_script` など）
- `content`: JSON not null（構造化 Q&A や問題セット、要約本文、スクリプト）
- `prompt_preset`: TEXT nullable（使用したプリセット ID/名前）
- `created_at`: TEXT not null
- Index: `learning_id`, `type`, `material_id`

### practice_session
- `id`: TEXT PK
- `learning_id`: TEXT FK -> learning.id
- `generated_content_id`: TEXT nullable（出題元の問題セットに紐付く場合）
- `question_ref`: JSON nullable（問題の ID/パスを参照するミニ情報）
- `answer_text`: TEXT not null
- `is_correct`: INTEGER nullable（0/1）
- `feedback`: JSON nullable（採点理由や解説）
- `score`: REAL nullable（部分点用）
- `created_at`: TEXT not null
- Index: `learning_id`, `generated_content_id`, `created_at desc`

### preset
- `id`: TEXT PK
- `subject`: TEXT not null（`math`/`english` など）
- `title`: TEXT not null（プリセット名）
- `system_prompt`: TEXT not null
- `user_instruction_template`: TEXT not null（プレースホルダー付き）
- `created_at`: TEXT not null
- `updated_at`: TEXT not null
- Index: `subject`, `title`

### semantic_node（将来的に拡張）
- `id`: TEXT PK
- `ref_type`: TEXT not null（`learning` | `material` | `generated_content` | `question` など）
- `ref_id`: TEXT not null
- `embedding`: BLOB/TEXT（ベクトル。クラウド併用時はポインタのみ）
- `metadata`: JSON（教科、タグ、難易度など）
- Index: `ref_type`, `ref_id`

## Workers 側（ラフ案）
- `logs`: AI リクエスト/レスポンスログ。`operation`, `learning_id`, `duration_ms`, `usage_token`.
- `embeddings`: 埋め込み格納用（D1 または外部ベクトル DB）。`semantic_node` と同等のカラムを想定。
- `ai_proxy_requests`: rate-limit / billing 用の履歴。

## 型エクスポート方針
- `packages/shared` で各テーブルの TypeScript 型 + zod スキーマを提供。
- スキーマは API 入出力（Hono）とフロント（フォーム）で共有。
- DB アクセス層はリポジトリパターンで隠蔽し、UI 層はスキーマに依存するだけにする。
