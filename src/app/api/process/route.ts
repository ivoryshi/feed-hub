import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

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

export async function POST(req: NextRequest) {
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: 'article_id required' }, { status: 400 })

  const db = getDb()
  const article = db.prepare(
    'SELECT id, title, summary, content FROM articles WHERE id = ?'
  ).get(article_id) as { id: number; title: string; summary: string | null; content: string | null } | undefined

  if (!article) return NextResponse.json({ error: 'article not found' }, { status: 404 })

  const text = article.content || article.summary || ''
  if (!text && !article.title) {
    return NextResponse.json({ error: 'no content to process' }, { status: 422 })
  }

  const apiKey = process.env.AI_API_KEY
  const baseUrl = process.env.AI_BASE_URL || 'https://api.moonshot.cn/v1'
  const model = process.env.AI_MODEL || 'moonshot-v1-8k'

  if (!apiKey) return NextResponse.json({ error: 'AI_API_KEY not configured' }, { status: 500 })

  const prompt = buildPrompt(article.title, text)

  let raw: string
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    })
    const data = await resp.json()
    raw = data.choices?.[0]?.message?.content || ''
  } catch (e) {
    return NextResponse.json({ error: 'AI API call failed', detail: String(e) }, { status: 502 })
  }

  let parsed: Record<string, unknown>
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] || raw)
  } catch {
    return NextResponse.json({ error: 'failed to parse AI response', raw }, { status: 502 })
  }

  const summary_ai = typeof parsed.summary_ai === 'string' ? parsed.summary_ai : null
  const key_points = Array.isArray(parsed.key_points) ? JSON.stringify(parsed.key_points) : null
  const content_type = CONTENT_TYPES.includes(parsed.content_type as string) ? parsed.content_type as string : null
  const time_horizon = TIME_HORIZONS.includes(parsed.time_horizon as string) ? parsed.time_horizon as string : null
  const signal_type = SIGNAL_TYPES.includes(parsed.signal_type as string) ? parsed.signal_type as string : null
  const sector = typeof parsed.sector === 'string' && parsed.sector !== 'null' ? parsed.sector : null
  const institution = typeof parsed.institution === 'string' && parsed.institution !== 'null' ? parsed.institution : null

  // 写入 article_meta
  db.prepare(`
    INSERT INTO article_meta
      (article_id, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution, processed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(article_id) DO UPDATE SET
      summary_ai    = excluded.summary_ai,
      key_points    = excluded.key_points,
      content_type  = excluded.content_type,
      time_horizon  = excluded.time_horizon,
      signal_type   = excluded.signal_type,
      sector        = excluded.sector,
      institution   = excluded.institution,
      processed_at  = excluded.processed_at
  `).run(article_id, summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution)

  // 写入 article_factors（先清空再插入）
  db.prepare('DELETE FROM article_factors WHERE article_id = ?').run(article_id)
  const factors = Array.isArray(parsed.factors) ? parsed.factors : []
  const insertFactor = db.prepare(
    'INSERT INTO article_factors (article_id, factor_name, factor_direction) VALUES (?, ?, ?)'
  )
  for (const f of factors) {
    if (FACTOR_NAMES.includes(f.factor_name) && FACTOR_DIRECTIONS.includes(f.factor_direction)) {
      insertFactor.run(article_id, f.factor_name, f.factor_direction)
    }
  }

  // 写入 tags（upsert tag，再关联 article_tags）
  db.prepare('DELETE FROM article_tags WHERE article_id = ? AND source = ?').run(article_id, 'ai')
  const rawTags = Array.isArray(parsed.tags) ? parsed.tags : []
  const tags = rawTags
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim().slice(0, 30))
    .slice(0, 8)

  const upsertTag = db.prepare(
    `INSERT INTO tags (name, category) VALUES (?, 'topic')
     ON CONFLICT(name) DO UPDATE SET category = COALESCE(category, 'topic')
     RETURNING id`
  )
  const linkTag = db.prepare(
    `INSERT OR IGNORE INTO article_tags (article_id, tag_id, source, confidence) VALUES (?, ?, 'ai', 0.85)`
  )
  for (const name of tags) {
    const row = upsertTag.get(name) as { id: number }
    linkTag.run(article_id, row.id)
  }

  return NextResponse.json({
    ok: true,
    meta: { summary_ai, key_points, content_type, time_horizon, signal_type, sector, institution },
    factors,
    tags,
  })
}
