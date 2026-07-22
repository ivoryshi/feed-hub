#!/usr/bin/env node
// Feed Hub 每日体检（运行于用户 Mac）：全链路健康检查 + 问题弹窗提醒
// 检查项覆盖历史事故：cron 停摆 / 回填代理挂掉(TCC EPERM) / 读书账号失效 /
// 爬虫停滞 / 验证页污染 / 分析积压 / 磁盘不足
// 运行：node ~/.feedhub/doctor.mjs   定时：launchd com.feedhub.doctor.plist 每天 09:00
// 改动后同步：cp scripts/doctor.mjs ~/.feedhub/

import { readFileSync, statSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

const BASE = process.env.FEEDHUB_BASE || 'https://feedhubs.org'
const ok = [], warn = [], crit = []
const pass = m => ok.push(`✅ ${m}`)
const w = m => warn.push(`⚠️ ${m}`)
const c = m => crit.push(`❌ ${m}`)

let token = ''
try { token = readFileSync(join(homedir(), '.feedhub', 'backfill-token'), 'utf-8').trim() }
catch { c('本地 token 文件缺失 ~/.feedhub/backfill-token') }

// ── 1. 站点存活 ──
try {
  const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(15000) })
  r.ok ? pass(`站点 ${BASE} 正常 (${r.status})`) : c(`站点异常 HTTP ${r.status}`)
} catch (e) { c(`站点无法访问: ${e.message}`) }

// ── 2. 云端体检接口 ──
let h = null
try {
  const r = await fetch(`${BASE}/api/health`, {
    headers: { 'x-backfill-token': token }, signal: AbortSignal.timeout(15000),
  })
  if (r.ok) h = await r.json()
  else c(`health API HTTP ${r.status}`)
} catch (e) { c(`health API 无法访问: ${e.message}`) }

if (h) {
  // 抓取活性（cron 每小时跑，26h 无新文章说明 cron 或 WeWeRSS 停了）
  h.articles_24h > 0
    ? pass(`近24h入库 ${h.articles_24h} 篇（最后抓取 ${h.last_fetch_at}）`)
    : w(`近24h零入库，检查 ECS crontab 与 WeWeRSS（最后抓取 ${h.last_fetch_at}）`)

  // 回填积压（>30 说明本地回填代理挂了——历史事故：TCC EPERM 静默失败两天）
  h.pending_backfill <= 30
    ? pass(`回填积压 ${h.pending_backfill} 篇（正常 <30）`)
    : c(`回填积压 ${h.pending_backfill} 篇！本地回填代理可能已挂，查 /tmp/feedhub-backfill.log`)

  // 分析积压
  h.analysis_backlog <= 20
    ? pass(`AI 分析积压 ${h.analysis_backlog} 篇（正常 <20）`)
    : w(`AI 分析积压 ${h.analysis_backlog} 篇，检查模型配置与 API 余额`)

  // 验证页污染（应恒为 0）
  h.polluted === 0 ? pass('无验证页污染') : c(`${h.polluted} 篇被验证页污染，需清洗`)

  // 读书账号（status=1 正常；失效则所有公众号断更——需重新扫码）
  for (const a of h.weread_accounts || []) {
    a.status === 1 ? pass(`读书账号「${a.name}」正常`) : c(`读书账号「${a.name}」已失效(status=${a.status})，去 rss.feedhubs.org 重新扫码`)
  }

  // 爬虫停滞（所有公众号 >48h 无新文说明爬虫或账号被风控）
  const feeds = h.wewerss_feeds || []
  const stale = feeds.filter(f => f.hours_since_newest > 48)
  if (feeds.length && stale.length === feeds.length) c('所有公众号 >48h 无新文章，WeWeRSS 爬虫疑似被风控')
  else if (stale.length) w(`${stale.map(f => f.name).join('、')} 超过48h无新文章（可能只是没发文）`)
  else if (feeds.length) pass(`公众号爬取新鲜度正常（${feeds.length} 个源）`)

  if (h.wewerss_http === 200) pass('WeWeRSS 服务正常')
  else c(`WeWeRSS 服务异常 (HTTP ${h.wewerss_http})，docker restart wewerss`)

  if (h.disk_free_gb !== undefined) {
    h.disk_free_gb > 5 ? pass(`ECS 磁盘余量 ${h.disk_free_gb}GB`) : c(`ECS 磁盘仅剩 ${h.disk_free_gb}GB`)
  }
  if (h.wewerss_db_error) w(`WeWeRSS DB 读取失败: ${h.wewerss_db_error}`)
}

// ── 3. 本地 launchd 任务 ──
try {
  const list = execSync('launchctl list', { encoding: 'utf-8' })
  const line = list.split('\n').find(l => l.includes('com.feedhub.backfill'))
  if (!line) c('launchd 回填任务未加载，launchctl load ~/Library/LaunchAgents/com.feedhub.backfill.plist')
  else {
    const exit = line.trim().split(/\s+/)[1]
    exit === '0' ? pass('launchd 回填任务已加载（上次退出码 0）') : w(`launchd 回填任务上次退出码 ${exit}，查 /tmp/feedhub-backfill.log`)
  }
} catch { w('无法读取 launchctl 状态') }

// 回填脚本必须在 ~/.feedhub（Desktop 会被 TCC 拦截）
existsSync(join(homedir(), '.feedhub', 'backfill-local.mjs'))
  ? pass('回填脚本位置正确 (~/.feedhub/)')
  : c('~/.feedhub/backfill-local.mjs 缺失，cp scripts/backfill-local.mjs ~/.feedhub/')

// 回填日志新鲜度（每小时跑，>3h 未动说明没在跑；EPERM = TCC 权限问题复发）
try {
  const log = '/tmp/feedhub-backfill.log'
  const ageH = (Date.now() - statSync(log).mtimeMs) / 3.6e6
  ageH < 3 ? pass(`回填日志 ${ageH.toFixed(1)}h 前有活动`) : w(`回填日志 ${ageH.toFixed(0)}h 无活动（Mac 休眠可忽略）`)
  const tail = execSync(`tail -30 ${log}`, { encoding: 'utf-8' })
  if (tail.includes('EPERM')) c('回填日志出现 EPERM！TCC 权限问题复发')
} catch { w('回填日志不存在，任务可能从未运行') }

// ── 报告 ──
const report = [...crit, ...warn, ...ok].join('\n')
console.log(`Feed Hub 体检 ${new Date().toLocaleString('zh-CN')}\n${report}`)
console.log(`\n结论：${crit.length} 严重 / ${warn.length} 警告 / ${ok.length} 正常`)

// 有问题弹 macOS 通知
if (crit.length || warn.length) {
  const msg = [...crit, ...warn].slice(0, 3).join('\\n').replace(/"/g, '')
  try {
    execSync(`osascript -e 'display notification "${msg}" with title "Feed Hub 体检发现 ${crit.length + warn.length} 个问题"'`)
  } catch { /* 通知失败不影响体检 */ }
}
process.exit(crit.length ? 2 : warn.length ? 1 : 0)
