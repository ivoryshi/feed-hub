import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSetting } from '@/lib/db'
import { stripHtml, processArticle } from '@/lib/processor'

// 本地回填代理专用 API：微信封锁机房 IP，全文由用户本机（住宅 IP）抓取后回传
// 鉴权：请求头 x-backfill-token 必须等于设置项 BACKFILL_TOKEN

function checkToken(req: NextRequest): boolean {
  const token = getSetting('BACKFILL_TOKEN')
  if (!token) return false
  return req.headers.get('x-backfill-token') === token
}

// GET — 待回填清单：微信来源且正文缺失的文章
export async function GET(req: NextRequest) {
  if (!checkToken(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

  const db = getDb()
  const pending = db.prepare(`
    SELECT a.id, a.url
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE s.url LIKE '%localhost:4000%'
      AND a.url LIKE '%mp.weixin.qq.com%'
      AND COALESCE(LENGTH(a.content), 0) < 200
    ORDER BY a.published_at DESC
    LIMIT ?
  `).all(limit)

  return NextResponse.json({ pending })
}

// POST — 回填单篇正文 { id, content }
export async function POST(req: NextRequest) {
  if (!checkToken(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id, content } = await req.json() as { id?: number; content?: string }
  if (!id || typeof content !== 'string') {
    return NextResponse.json({ error: 'id and content required' }, { status: 400 })
  }

  // 内容质量守卫：拒绝验证页和空壳内容
  if (content.includes('环境异常')) {
    return NextResponse.json({ error: 'verification page rejected' }, { status: 422 })
  }
  const cleanLen = stripHtml(content).length
  if (cleanLen < 200) {
    return NextResponse.json({ error: `content too short after strip (${cleanLen})` }, { status: 422 })
  }

  const db = getDb()
  const r = db.prepare(`
    UPDATE articles SET content = ?
    WHERE id = ? AND COALESCE(LENGTH(content), 0) < 200
  `).run(content, id)

  // 时序补偿：每日 cron 08:00 抓到新文章时正文还没回填，AI 分析被守卫拒绝；
  // 回填成功且尚未分析过的文章在此补触发（fire-and-forget，不阻塞回填节奏）
  if (r.changes > 0) {
    const hasMeta = db.prepare('SELECT 1 FROM article_meta WHERE article_id = ?').get(id)
    if (!hasMeta) processArticle(id).catch(() => {})
  }

  return NextResponse.json({ ok: true, updated: r.changes, clean_length: cleanLen })
}
