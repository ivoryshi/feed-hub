import { getDb } from './db'

const CONTENT_TYPES = ['news', 'analysis', 'education', 'opinion', 'data_report', 'strategy_note']
const TIME_HORIZONS = ['short', 'medium', 'long', 'timeless']
const SIGNAL_TYPES = ['bullish', 'bearish', 'neutral']
const FACTOR_NAMES = ['value', 'momentum', 'quality', 'size', 'low_vol', 'macro', 'carry', 'growth', 'other']
const FACTOR_DIRECTIONS = ['positive', 'negative', 'neutral']

function buildPrompt(title: string, content: string): string {
  const text = content.slice(0, 3000)
  return `你是一位专业的投资研究分析师。请分析以下文章并以 JSON 格式返回结构化信息。

文章标题：${title}

文章内容：
${text}

请严格返回如下 JSON 格式，不要有任何其他文字：
{
  "summary_ai": "用2-3句话概括文章核心观点",
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
  "tags": ["主题标签1", "主题标签2", "主题标签3"]
}

tags 说明：提取3-6个最能描述文章核心主题的中文标签，如「美联储」「半导体」「港股」「量化策略」「资产配置」等。`
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

  const text = article.content || article.summary || ''
  if (!text && !article.title) return { article_id: articleId, ok: false, error: 'no content' }

  const apiKey = process.env.AI_API_KEY
  const baseUrl = process.env.AI_BASE_URL || 'https://api.moonshot.cn/v1'
  const model = process.env.AI_MODEL || 'moonshot-v1-8k'
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

  db.prepare(`
    INSERT INTO article_meta
      (article_id, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET
      summary_ai = excluded.summary_ai, key_points = excluded.key_points,
      content_type = excluded.content_type, time_horizon = excluded.time_horizon,
      signal_type = excluded.signal_type, sector = excluded.sector,
      institution = excluded.institution, processed_at = excluded.processed_at
  `).run(articleId, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution)

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
  const tags = rawTags.filter((t): t is string => typeof t === 'string').map(t => t.trim().slice(0, 30)).slice(0, 8)
  const upsertTag = db.prepare(
    `INSERT INTO tags (name, category) VALUES (?, 'topic')
     ON CONFLICT(name) DO UPDATE SET category = COALESCE(category, 'topic') RETURNING id`
  )
  const linkTag = db.prepare(
    `INSERT OR IGNORE INTO article_tags (article_id, tag_id, source, confidence) VALUES (?, ?, 'ai', 0.85)`
  )
  for (const name of tags) {
    const row = upsertTag.get(name) as { id: number }
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
