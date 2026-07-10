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

### 定时任务（三级流水线，北京时间，一天四轮）
| 时间 | 任务 | 位置 |
|---|---|---|
| 07/11/15/19:00 | WeWeRSS 爬公众号 | ECS Docker env `CRON_EXPRESSION="0 7,11,15,19 * * *"` + `TZ=Asia/Shanghai` |
| 07/11/15/19:30 | feedhub 抓取+AI分析 | ECS crontab `30 7,11,15,19 * * *` → GET `/api/fetch` |
| 08/12/16/20:30 | 微信正文回填+补分析 | Mac launchd `com.feedhub.backfill.plist` |
- ⚠️ 三级顺序不能乱：公众号发文 → WeWeRSS 先爬到 → feedhub 才抓得到 → 回填后才有全文可分析
- 2026-07-10 曾因 WeWeRSS 01:35/13:35 爬取与 feedhub 08:00 抓取错位，导致早晨发文延迟一天才入库
- ⚠️ WeWeRSS 上游局限（微信读书接口）：同一公众号一天多次推送只保留最新一次，爬取没赶上的会永久漏掉
  （2026-07-08 2030FY《深扒Anthropic》案例）——一天四轮把漏抓窗口压到 4 小时，无法彻底根治
- 日志：ECS `/var/log/feedhub-cron.log`，Mac `/tmp/feedhub-backfill.log`

### Obsidian 导入规则
- 优先：Google Drive（`GDRIVE_CLIPPINGS_FOLDER_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON`，已于 2026-07-09 配置于 ECS settings 表）
- Service Account：`feedhub-sync@feedhub-sync-66522.iam.gserviceaccount.com`（GCP 项目 feedhub-sync-66522，vault 根目录已共享查看权限，密钥只存 DB 不落盘）
- 降级：本地路径 `~/Desktop/My Vault/Clippings/`（仅本地开发时生效）
- 触发条件：frontmatter `tags` 含 `clippings`
- 去重 key：文件名（guid），跨设备迁移后依然有效
- obsidian 类型 source 不参与 RSS 抓取循环（fetchAllSources 已排除）

### Google Drive 文件夹 ID 备查（vault 根目录已整体共享给 SA）
| 文件夹 | ID |
|---|---|
| vault 根目录 | `1huP1nXnSnf5jpDmVmmAd3dbGFLrt33IT` |
| Clippings（当前同步目标） | `1y8DkMWvwOmhiQ-MiPpvO8Kiz15A-DksB` |
| 01-思考 | `1QV2HQ7E_z5my3sqLFACxaM5m4adYQXGF` |
| 02-wiki | `1ActIm3O37SIv1zvafacTjl2Mhn4QnNA2` |
| 03-产品规划 | `1fgnWNENZucibecUmWQq3xkowOBKkihd7` |
| 04-投研 | `1o5oNbxaWUiPw0J_06MsQrZQViGcycYGk` |
| 05-自媒体 | `1oSAp_WDZ306u8y8OB6fGYzB0CvWCjW7r` |
| 06-选题 | `1nyH3w8A77qgJpXizg33QJr3XfoJLdtpj` |
| 07-日常 | `1bSv940LPHnCVu_QtO-PV17MsVWuDruWP` |
| 08-归档 | `1VkCMlYXmrKF685wDmFEgpw3_0ZpfFJfI` |
| 00-inbox | `1z1vCot0ynm59tuRSleVogP9j5fcZBxMD` |

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

### 微信全文获取架构（本地回填代理）
- **微信封锁所有机房 IP**：ECS 直连、WeWeRSS mode=fulltext、Jina Reader 全部拿到「环境异常」验证页（2026-07-09 验证），只有住宅 IP 能取到全文
- 架构：ECS 提供 `/api/backfill` API（GET 待回填清单 / POST 回传正文，`x-backfill-token` 鉴权，token 在 settings 表 `BACKFILL_TOKEN` 和本机 `~/.feedhub/backfill-token`）
- 本机脚本 `scripts/backfill-local.mjs` 用浏览器 UA 抓 mp.weixin.qq.com，每篇间隔 4-7s，连续 3 次被拦自动终止本轮
- launchd `com.feedhub.backfill.plist` 每天 09:30 跑一次（ECS cron 08:00 抓完新文章后）
- 质量守卫：POST 端拒绝含「环境异常」或剥离后 <200 字的内容；processor 对 <200 字正文拒绝分析（防止模型凭标题编造总结）
- Nginx `client_max_body_size 10m`（微信页面 HTML 数百 KB，默认 1m 会 413）

### AI 深度总结与打标（skill：my vault/05-自媒体/素材库/skill.md）
- prompt 集中在 `src/lib/processor.ts` → `buildPrompt`：约500字深度总结＋小标题大纲＋金句＋分类标签
- 送模型前 `stripHtml()` 剥离 HTML（WeWeRSS 存的是整页 HTML，不剥离模型只能读到 CSS 样板）
- word_count/reading_minutes 由代码按纯文本确定性计算（400字/分钟），不让模型估
- 标签分类体系：market/sector/theme/style/person/institution/other，存 tags.category，前端按分类配色
- article_meta 扩展列：section_outline(JSON) / golden_quotes(JSON) / word_count / reading_minutes
- max_tokens=4000 防输出截断；模型配置注意：settings 表 AI_MODEL 曾被误设为 8k 导致质量问题，应为 moonshot-v1-32k

### WeWeRSS 配置
- Docker 镜像：`cooderl/wewe-rss-sqlite:latest`（与本地版本保持一致，不要用 `wewe-rss:latest`，DB schema 不同）
- 数据目录：`/opt/wewerss/data/wewe-rss.db`
- 端口：4000（内部），通过 Nginx 反代到 `rss.feedhubs.org`
- Feed URL 格式：`http://localhost:4000/feeds/{MP_ID}.atom`（**不要手写 limit 参数**）
  - limit 由 fetcher 统一自动追加，集中配置在 `src/lib/fetcher.ts` → `WEWERSS_FEED_LIMIT`（当前 300）
  - 同文件 `FETCH_ITEM_CAP`（单次抓取处理上限，当前 300）必须 >= `WEWERSS_FEED_LIMIT`，两处联动
  - ⚠️ WeWeRSS 默认不带 limit 只返回 10 条——2026-07-09 曾因手写 limit 漏配导致 2030FY 只抓 10 篇
  - limit 数值变更前需和用户确认，不要自行决定
- 抓取停滞排查方法（2026-07-09 中金点睛案例）：对比 WeWeRSS DB `articles` 表最新 publish_time 与 feedhub 侧最新 published_at——两边一致说明管道无漏，是 WeWeRSS 爬虫层被微信限制（日志特征 `getMpArticles(...) articles: 0`）

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
| 2026-07-09 | WeWeRSS limit 集中化：fetcher 自动追加 limit=300，废除 URL 手写参数；FETCH_ITEM_CAP 100→300 |
| 2026-07-09 | AI 深度总结与打标 skill 落地：500字总结+大纲+金句+分类标签，article_meta 扩展4列 |
| 2026-07-09 | 发现微信封锁机房 IP，建立本地回填代理架构（/api/backfill + backfill-local.mjs + launchd） |
| 2026-07-09 | fetcher 加 mode=fulltext 与空正文回填；processor 加短内容防幻觉守卫 |
| 2026-07-09 | Google Drive 同步上线：gcloud CLI 建 SA（绕过网页控制台被墙），首次同步导入 11 篇；obsidian source 退出 RSS 抓取循环 |
