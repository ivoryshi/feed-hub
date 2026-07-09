import { getDb, getSetting } from './db'

const CONTENT_TYPES = ['news', 'analysis', 'education', 'opinion', 'data_report', 'strategy_note']
const TIME_HORIZONS = ['short', 'medium', 'long', 'timeless']
const SIGNAL_TYPES = ['bullish', 'bearish', 'neutral']
const FACTOR_NAMES = ['value', 'momentum', 'quality', 'size', 'low_vol', 'macro', 'carry', 'growth', 'other']
const FACTOR_DIRECTIONS = ['positive', 'negative', 'neutral']

// 标签分类体系（前端差异化展示 + 后期 hybrid 检索的过滤维度）
export const TAG_CATEGORIES = ['market', 'sector', 'theme', 'style', 'person', 'institution', 'other']

// WeWeRSS fulltext 返回整页 HTML（含 CSS/meta 样板），必须剥离后再送模型，
// 否则正文被标记代码淹没，模型只能输出空泛总结
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildPrompt(title: string, content: string): string {
  const text = content.slice(0, 20000)
  return `你是一位专业的投资研究分析师，负责对海量投研自媒体内容做第一轮粗读筛查。请对以下文章做全文扫描，以 JSON 格式返回深度总结与全面打标。

文章标题：${title}

文章内容：
${text}

请严格返回如下 JSON 格式，不要有任何其他文字：
{
  "summary_ai": "深度总结（要求见下）",
  "section_outline": [{"heading": "小标题或章节名", "summary": "该部分一句话摘要"}],
  "golden_quotes": ["文中金句原文"],
  "key_points": ["要点1", "要点2", "要点3"],
  "content_type": "其中之一：news/analysis/education/opinion/data_report/strategy_note",
  "time_horizon": "其中之一：short/medium/long/timeless（short<1个月，medium 1-12个月，long>1年，timeless永恒）",
  "signal_type": "其中之一：bullish/bearish/neutral，如无明确方向则为 null",
  "sector": "行业板块，如 technology/finance/energy/consumer/healthcare/macro/real_estate/other，无则为 null",
  "institution": "作者所属机构或媒体，无则为 null",
  "factors": [
    {
      "factor_name": "其中之一：value/momentum/quality/size/low_vol/macro/carry/growth/other",
      "factor_direction": "其中之一：positive/negative/neutral"
    }
  ],
  "tags": [{"name": "标签", "category": "market/sector/theme/style/person/institution/other 其中之一"}]
}

summary_ai 要求：
1. 基于全文扫描提取大意，不能只依据开头几段；采用「摘要+总结」的逻辑概括全文主旨，行文尽量贴近原文风格
2. 目标约 500 字。这是替代人工粗读的深度总结，不是三两句摘要，不要过度压缩
3. 段首段末的重要观点、全文总结性论断必须体现在总结中
4. 原文引用过的其他文章或报告，在总结中保留其提法（反链接式引用）

section_outline 要求：小标题一般反映全文框架，逐条列出各部分并各配一句话摘要；若原文无明显小标题，按内容逻辑自行划分 3-6 个部分。

golden_quotes 要求：罗列文中金句原文（1-5 条），没有明显金句就给空数组，不必强凑。

tags 要求：
1. 基于全文分词扫描，覆盖要全：市场（A股/港股/美股/美债等）归 market；行业板块（半导体/消费/能源等）归 sector；主题概念（拥挤度/资产配置/美联储/AI等）归 theme；投资风格（成长/价值/量化/宏观对冲等）归 style；文中重要人物或作者归 person；机构媒体（中金/桥水等）归 institution；其余归 other
2. 数量按内容密度给：信息密集的深度文章 20-40 个正常，短讯 5-10 个即可
3. 标签用于筛选、反链接和后期向量混合检索的索引，宁全勿缺，但不要造词，必须是文中实际出现或直接对应的概念`
}

export type ProcessResult = {
  article_id: number
  ok: boolean
  error?: string
  tokens?: number
}

export async function processArticle(articleId: number): Promise<ProcessResult> {
  const db = getDb()
  const article = db.prepare(
    'SELECT id, title, summary, content FROM articles WHERE id = ?'
  ).get(articleId) as { id: number; title: string; summary: string | null; content: string | null } | undefined

  if (!article) return { article_id: articleId, ok: false, error: 'not found' }

  const text = stripHtml(article.content || article.summary || '')
  // 正文太短时禁止分析——否则模型会仅凭标题编造总结（幻觉）
  if (text.length < 200) {
    return { article_id: articleId, ok: false, error: 'content too short (<200 chars), skip to avoid hallucination' }
  }

  const apiKey = getSetting('AI_API_KEY')
  const baseUrl = getSetting('AI_BASE_URL', 'https://api.moonshot.cn/v1')
  const model = getSetting('AI_MODEL', 'moonshot-v1-32k')
  if (!apiKey) return { article_id: articleId, ok: false, error: 'no API key' }

  let raw: string
  let tokens = 0
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: buildPrompt(article.title, text) }],
        temperature: 0.2,
        // 深度总结+大纲+金句+大量标签，输出体量大，明确上限防截断
        max_tokens: 4000,
      }),
    })
    const data = await resp.json()
    raw = data.choices?.[0]?.message?.content || ''
    tokens = data.usage?.total_tokens || 0
  } catch (e) {
    return { article_id: articleId, ok: false, error: String(e) }
  }

  let parsed: Record<string, unknown>
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] || raw)
  } catch {
    return { article_id: articleId, ok: false, error: 'parse failed', tokens }
  }

  const summary_ai    = typeof parsed.summary_ai === 'string' ? parsed.summary_ai : null
  const key_points    = Array.isArray(parsed.key_points) ? JSON.stringify(parsed.key_points) : null
  const content_type  = CONTENT_TYPES.includes(parsed.content_type as string) ? parsed.content_type as string : null
  const time_horizon  = TIME_HORIZONS.includes(parsed.time_horizon as string) ? parsed.time_horizon as string : null
  const signal_type   = SIGNAL_TYPES.includes(parsed.signal_type as string) ? parsed.signal_type as string : null
  const sector        = typeof parsed.sector === 'string' && parsed.sector !== 'null' ? parsed.sector : null
  const institution   = typeof parsed.institution === 'string' && parsed.institution !== 'null' ? parsed.institution : null
  const section_outline = Array.isArray(parsed.section_outline) ? JSON.stringify(parsed.section_outline) : null
  const golden_quotes   = Array.isArray(parsed.golden_quotes) ? JSON.stringify(parsed.golden_quotes) : null
  // 字数/阅读时长由代码基于纯文本确定性计算，不依赖模型估算（中文阅读速度约 400 字/分钟）
  const word_count      = text.length
  const reading_minutes = Math.max(1, Math.round(text.length / 400))

  db.prepare(`
    INSERT INTO article_meta
      (article_id, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution,
       section_outline, golden_quotes, word_count, reading_minutes, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET
      summary_ai = excluded.summary_ai, key_points = excluded.key_points,
      content_type = excluded.content_type, time_horizon = excluded.time_horizon,
      signal_type = excluded.signal_type, sector = excluded.sector,
      institution = excluded.institution,
      section_outline = excluded.section_outline, golden_quotes = excluded.golden_quotes,
      word_count = excluded.word_count, reading_minutes = excluded.reading_minutes,
      processed_at = excluded.processed_at
  `).run(articleId, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution,
         section_outline, golden_quotes, word_count, reading_minutes)

  db.prepare('DELETE FROM article_factors WHERE article_id = ?').run(articleId)
  const factors = Array.isArray(parsed.factors) ? parsed.factors : []
  const insertFactor = db.prepare(
    'INSERT INTO article_factors (article_id, factor_name, factor_direction) VALUES (?, ?, ?)'
  )
  for (const f of factors) {
    if (FACTOR_NAMES.includes(f.factor_name) && FACTOR_DIRECTIONS.includes(f.factor_direction)) {
      insertFactor.run(articleId, f.factor_name, f.factor_direction)
    }
  }

  db.prepare('DELETE FROM article_tags WHERE article_id = ? AND source = ?').run(articleId, 'ai')
  const rawTags = Array.isArray(parsed.tags) ? parsed.tags : []
  // 兼容两种格式：{name, category} 对象（新）或纯字符串（旧）
  const tags = rawTags
    .map((t: unknown) => {
      if (typeof t === 'string') return { name: t.trim().slice(0, 30), category: 'theme' }
      if (t && typeof t === 'object' && typeof (t as Record<string, unknown>).name === 'string') {
        const cat = (t as Record<string, unknown>).category
        return {
          name: ((t as Record<string, unknown>).name as string).trim().slice(0, 30),
          category: TAG_CATEGORIES.includes(cat as string) ? cat as string : 'theme',
        }
      }
      return null
    })
    .filter((t): t is { name: string; category: string } => !!t && t.name.length > 0)
    .slice(0, 40)
  const upsertTag = db.prepare(
    `INSERT INTO tags (name, category) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET category = excluded.category RETURNING id`
  )
  const linkTag = db.prepare(
    `INSERT OR IGNORE INTO article_tags (article_id, tag_id, source, confidence) VALUES (?, ?, 'ai', 0.85)`
  )
  for (const t of tags) {
    const row = upsertTag.get(t.name, t.category) as { id: number }
    linkTag.run(articleId, row.id)
  }

  return { article_id: articleId, ok: true, tokens }
}

// 批量处理一组 article_id，串行执行避免并发打爆 API
export async function processArticles(articleIds: number[]): Promise<{
  processed: number
  failed: number
  total_tokens: number
  errors: { id: number; error: string }[]
}> {
  let processed = 0, failed = 0, total_tokens = 0
  const errors: { id: number; error: string }[] = []

  for (const id of articleIds) {
    const result = await processArticle(id)
    if (result.ok) {
      processed++
      total_tokens += result.tokens || 0
    } else {
      failed++
      errors.push({ id, error: result.error || 'unknown' })
    }
    // 每篇间隔 500ms，避免 rate limit
    await new Promise(r => setTimeout(r, 500))
  }

  return { processed, failed, total_tokens, errors }
}
