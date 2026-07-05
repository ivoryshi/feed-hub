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
- **每天 10:00**：GET `/api/fetch` → 抓取所有 RSS/WeChat/Podcast + 扫描 Obsidian Clippings
- launchd plist：`~/Library/LaunchAgents/com.feedhub.daily-fetch.plist`
- 日志：`/tmp/feedhub-fetch.log`

### Obsidian 导入规则
- 路径：`~/Desktop/My Vault/Clippings/`
- 触发条件：frontmatter `tags` 含 `clippings`
- 去重 key：文件名（guid）

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
