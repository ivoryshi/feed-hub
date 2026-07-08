# Feed Hub 开发 Wiki

## 逻辑约束清单

### 新增 source type 时必须同步修改的所有层

每次新增一个 source type（如 `twitter`、`obsidian`），必须同步以下 **7 处**：

| # | 位置 | 内容 | 文件 |
|---|------|------|------|
| 1 | DB schema | `sources.type` CHECK 约束 | `src/lib/db.ts` → `initSchema` |
| 2 | DB migrate | 重建 sources 表的 CHECK 约束 | `src/lib/db.ts` → `migrate` |
| 3 | Fetcher | 特殊字段处理（如无标题） | `src/lib/fetcher.ts` |
| 4 | Sources API | POST 校验白名单 | `src/app/api/sources/route.ts` |
| 5 | 前端下拉 | 添加表单 `<option>` | `src/app/page.tsx` → 订阅源 tab |
| 6 | 前端卡片 | 渲染逻辑差异化 | `src/app/page.tsx` → 文章卡片 |
| 7 | SOURCE_LABELS | 徽章样式定义 | `src/app/page.tsx` → `SOURCE_LABELS` |

---

### 新增 article 字段时必须同步修改的所有层

| # | 位置 | 文件 |
|---|------|------|
| 1 | DB schema `articles` 表定义 | `src/lib/db.ts` → `initSchema` |
| 2 | DB migrate ALTER / 重建逻辑 | `src/lib/db.ts` → `migrate` |
| 3 | Fetcher insert 语句 | `src/lib/fetcher.ts` |
| 4 | Obsidian importer insert 语句 | `src/lib/obsidian-importer.ts` |
| 5 | Articles API SELECT 字段 | `src/app/api/articles/route.ts` |
| 6 | Search API SELECT 字段 | `src/app/api/search/route.ts` |
| 7 | 前端 Article 类型定义 | `src/app/page.tsx` → `type Article` |
| 8 | 前端卡片渲染 | `src/app/page.tsx` → 文章卡片 |
| 9 | FTS5 触发器（如字段需全文检索） | `src/lib/db.ts` → `initSchema` |
| 10 | MCP server（如需对外暴露） | `mcp-server.js` |

---

### 新增 AI 处理字段时必须同步修改的所有层

| # | 位置 | 文件 |
|---|------|------|
| 1 | `article_meta` 表定义 | `src/lib/db.ts` |
| 2 | Process API prompt 模板 | `src/app/api/process/route.ts` → `buildPrompt` |
| 3 | Process API 解析 + 写入逻辑 | `src/app/api/process/route.ts` |
| 4 | Articles API JOIN 字段 | `src/app/api/articles/route.ts` |
| 5 | Search API JOIN 字段 | `src/app/api/search/route.ts` |
| 6 | 前端 Article 类型定义 | `src/app/page.tsx` → `type Article` |
| 7 | 前端卡片展示 | `src/app/page.tsx` |

---

## 关键架构说明

### 数据库文件位置
```
data/feed-hub.db   # SQLite，gitignore 中，不进版本库
```

### source type 当前枚举值
```
rss / wechat / podcast / obsidian / twitter
```

### 定时任务
- **每天 08:00（ECS 服务器时间）**：GET `/api/fetch` → 抓取所有 RSS/WeChat/Podcast + Obsidian 导入
- ECS crontab：`0 8 * * * curl -s http://localhost:3000/api/fetch >> /var/log/feedhub-cron.log 2>&1`

### Obsidian 导入规则
- 优先：Google Drive（需配置 `GDRIVE_CLIPPINGS_FOLDER_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON`）
- 降级：本地路径 `~/Desktop/My Vault/Clippings/`
- 触发条件：frontmatter `tags` 含 `clippings`
- 去重 key：文件名（guid）

### 配置管理
- 配置优先级：DB `settings` 表 > `.env.local` > 代码默认值
- 前端配置面板支持的 key：`AI_VENDOR` / `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` / `DASHSCOPE_API_KEY` / `GDRIVE_CLIPPINGS_FOLDER_ID` / `GOOGLE_SERVICE_ACCOUNT_JSON`
- `getSetting(key, fallback)` 统一读取入口，在 `src/lib/db.ts`

### 草稿系统
- DB 表：`drafts`（id / title / content / created_at / updated_at）
- API：`/api/drafts` GET/POST，`/api/drafts/[id]` GET/PUT/DELETE
- 前端：写文章 tab，左侧草稿列表，1s 自动保存

### 转写系统（阿里云 DashScope Paraformer-v2）
- 异步流程：提交任务 → 存 `transcription_task_id` → 前端轮询 `/api/transcribe/status` → 完成后存 `transcription`
- 免费额度：100小时/月
- 需配置：`DASHSCOPE_API_KEY`

### WeWeRSS 配置
- Docker 镜像：`cooderl/wewe-rss-sqlite:latest`（与本地版本保持一致，不要用 `wewe-rss:latest`，DB schema 不同）
- 数据目录：`/opt/wewerss/data/wewe-rss.db`
- 端口：4000（内部），通过 Nginx 反代到 `rss.feedhubs.org`
- Feed URL 格式：`http://localhost:4000/feeds/{MP_ID}.atom?limit=50`
  - **limit 当前设为 50**，后期扩容时统一修改所有来源 URL
  - ⚠️ 默认不带 limit 参数只返回 10 条，新增公众号来源时必须手动加 `?limit=50`
  - limit 数值变更前需和用户确认，不要自行决定

### Twitter/X 接入方式
- 通过 RSSHub 公共实例转 RSS
- URL 格式：`https://rsshub.app/twitter/user/:username`
- 推文无标题，卡片直接展示 content，fetcher 用内容前 60 字作 title 备用

### AI 处理字段写入表
- `article_meta`：summary_ai / key_points / content_type / time_horizon / signal_type / sector / institution
- `article_factors`：factor_name / factor_direction
- `article_tags` + `tags`：AI 提取的主题标签

---

## 变更历史

| 日期 | 变更内容 |
|------|---------|
| 2026-07-02 | 初始版本：sources / articles / FTS5 |
| 2026-07-03 | 新增 podcast 支持 + Kimi 转写 |
| 2026-07-04 | 新增知识库 schema（9张表） |
| 2026-07-04 | AI 处理 pipeline：process API + article_meta + article_factors |
| 2026-07-04 | 标签筛选 UI + /api/tags |
| 2026-07-05 | published_at 统一转 ISO 8601，fetch 上限改 100 |
| 2026-07-05 | 新增 obsidian source type，导入 85 篇存量 clippings |
| 2026-07-05 | 新增 twitter source type，articles.title 改为可空 |
| 2026-07-07 | DashScope Paraformer-v2 转写 + 前端文稿展示 |
| 2026-07-07 | 草稿多篇管理（drafts 表 + API + 编辑器左侧栏） |
| 2026-07-07 | 前端模型配置面板（settings 表，DB 优先于 env） |
| 2026-07-07 | Articles API 优化：非 podcast 不返回 content（444KB→31KB） |
| 2026-07-07 | AI 分析结果展开/收起 UI，summary 默认 5 行 |
| 2026-07-07 | 部署至阿里云 ECS 香港（47.239.24.2），域名 feedhubs.org，Cloudflare CDN |
| 2026-07-07 | WeWeRSS Docker 部署 + 数据迁移，公众号入库 tab（rss.feedhubs.org） |
| 2026-07-07 | Google Drive importer 代码完成（gdrive-importer.ts），待配置 Service Account |
| 2026-07-07 | next.config.js 修正为 Next.js 14 正确语法（experimental.serverComponentsExternalPackages） |
