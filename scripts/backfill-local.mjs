#!/usr/bin/env node
// 本地全文回填代理：在用户本机（住宅 IP）抓取微信文章正文，回传 feedhubs.org
// 背景：微信封锁所有机房 IP（ECS/Jina 均拿到验证页），只有住宅 IP 能取到全文
// 运行：node scripts/backfill-local.mjs [limit]
// 定时：launchd com.feedhub.backfill.plist 每天 09:30
// token：~/.feedhub/backfill-token（与 ECS settings 表 BACKFILL_TOKEN 一致）

import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = process.env.FEEDHUB_BASE || 'https://feedhubs.org'
const LIMIT = parseInt(process.argv[2] || '100')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

let token
try {
  token = readFileSync(join(homedir(), '.feedhub', 'backfill-token'), 'utf-8').trim()
} catch {
  console.error('缺少 token 文件：~/.feedhub/backfill-token')
  process.exit(1)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const res = await fetch(`${BASE}/api/backfill?limit=${LIMIT}`, {
    headers: { 'x-backfill-token': token },
  })
  if (!res.ok) throw new Error(`pending list: HTTP ${res.status}`)
  const { pending } = await res.json()
  console.log(`待回填 ${pending.length} 篇`)

  let ok = 0, fail = 0, blocked = 0
  for (const [i, art] of pending.entries()) {
    try {
      const page = await fetch(art.url, { headers: { 'User-Agent': UA } })
      const html = await page.text()

      if (html.includes('环境异常')) {
        blocked++
        console.log(`[${i + 1}/${pending.length}] #${art.id} 被风控拦截`)
        // 连续 3 次被拦说明本机 IP 也被限流了，停止本轮，明天再试
        if (blocked >= 3) { console.log('连续被拦，终止本轮'); break }
        await sleep(30000)
        continue
      }
      blocked = 0

      const post = await fetch(`${BASE}/api/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-backfill-token': token },
        body: JSON.stringify({ id: art.id, content: html }),
      })
      const result = await post.json()
      if (post.ok) {
        ok++
        console.log(`[${i + 1}/${pending.length}] #${art.id} ok (正文 ${result.clean_length} 字)`)
      } else {
        fail++
        console.log(`[${i + 1}/${pending.length}] #${art.id} 拒绝: ${result.error}`)
      }
    } catch (e) {
      fail++
      console.log(`[${i + 1}/${pending.length}] #${art.id} 出错: ${e.message}`)
    }
    // 每篇间隔 4-7 秒，模拟人工浏览节奏，避免触发风控
    await sleep(4000 + Math.random() * 3000)
  }
  console.log(`完成：成功 ${ok}，失败 ${fail}`)
}

main().catch(e => { console.error(e); process.exit(1) })
