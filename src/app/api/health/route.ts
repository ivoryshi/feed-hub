import { NextRequest, NextResponse } from 'next/server'
import { getDb, getSetting } from '@/lib/db'
import Database from 'better-sqlite3'
import { statfsSync } from 'fs'

// 系统体检接口（doctor.mjs 每日调用）：一次返回全链路健康指标
// 鉴权复用 BACKFILL_TOKEN，避免运营数据裸奔

export async function GET(req: NextRequest) {
  const token = getSetting('BACKFILL_TOKEN')
  if (!token || req.headers.get('x-backfill-token') !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = getDb()
  const report: Record<string, unknown> = { ts: new Date().toISOString() }

  // 1. 抓取活性：近24h入库量 + 最后抓取时间
  report.articles_24h = (db.prepare(
    `SELECT COUNT(*) as n FROM articles WHERE fetched_at >= datetime('now', '-1 day')`
  ).get() as { n: number }).n
  report.last_fetch_at = (db.prepare(
    `SELECT MAX(fetched_at) as t FROM articles`
  ).get() as { t: string | null }).t

  // 2. 回填积压：微信文章正文缺失数（持续增长 = 本地回填代理挂了）
  report.pending_backfill = (db.prepare(`
    SELECT COUNT(*) as n FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE s.url LIKE '%localhost:4000%' AND a.url LIKE '%mp.weixin.qq.com%'
      AND COALESCE(LENGTH(a.content), 0) < 200
  `).get() as { n: number }).n

  // 3. 分析积压：有正文但未出 AI 结果（增长 = 分析管道或模型配置出问题）
  report.analysis_backlog = (db.prepare(`
    SELECT COUNT(*) as n FROM articles a
    LEFT JOIN article_meta m ON m.article_id = a.id
    WHERE m.article_id IS NULL AND LENGTH(a.content) >= 200
  `).get() as { n: number }).n

  // 4. 污染检测：验证页混入（应恒为 0）
  report.polluted = (db.prepare(
    `SELECT COUNT(*) as n FROM articles WHERE content LIKE '%环境异常%' OR summary LIKE '%环境异常%'`
  ).get() as { n: number }).n

  // 5. WeWeRSS：读书账号状态 + 各公众号爬取新鲜度
  try {
    const wdb = new Database('/opt/wewerss/data/wewe-rss.db', { readonly: true })
    report.weread_accounts = wdb.prepare(`SELECT name, status FROM accounts`).all()
    report.wewerss_feeds = wdb.prepare(`
      SELECT f.mp_name as name,
             CAST((strftime('%s','now') - MAX(a.publish_time)) / 3600 AS INTEGER) as hours_since_newest
      FROM feeds f LEFT JOIN articles a ON a.mp_id = f.id GROUP BY f.id
    `).all()
    wdb.close()
  } catch (e) {
    report.wewerss_db_error = String(e)
  }

  // 6. WeWeRSS 服务存活
  try {
    const r = await fetch('http://localhost:4000/', { signal: AbortSignal.timeout(5000) })
    report.wewerss_http = r.status
  } catch {
    report.wewerss_http = 0
  }

  // 7. 磁盘余量
  try {
    const s = statfsSync('/')
    report.disk_free_gb = Math.round((s.bavail * s.bsize) / 1e9 * 10) / 10
  } catch { /* 非关键 */ }

  return NextResponse.json(report)
}
