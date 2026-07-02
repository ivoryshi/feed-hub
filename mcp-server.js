#!/usr/bin/env node
/**
 * Feed Hub MCP Server
 * 供 Claude 等模型通过 stdio 调用，查询本地投研知识库
 *
 * 启动方式（在 Claude Desktop 的 mcp config 中添加）:
 * {
 *   "feed-hub": {
 *     "command": "node",
 *     "args": ["/absolute/path/to/feed-hub/mcp-server.js"]
 *   }
 * }
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.join(__dirname, 'data', 'feed-hub.db')

function getDb() {
  try {
    const db = new Database(DB_PATH, { readonly: true })
    return db
  } catch {
    return null
  }
}

const server = new Server(
  { name: 'feed-hub', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_articles',
      description: '全文搜索投研知识库中的文章。支持关键词、公司名、行业术语等',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '返回条数，默认 10，最大 50', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_recent_articles',
      description: '获取最新文章，可按来源过滤',
      inputSchema: {
        type: 'object',
        properties: {
          source_name: { type: 'string', description: '来源名称（模糊匹配），不传则返回全部' },
          days: { type: 'number', description: '最近 N 天，默认 7', default: 7 },
          limit: { type: 'number', description: '返回条数，默认 20', default: 20 },
        },
      },
    },
    {
      name: 'list_sources',
      description: '列出所有已订阅的信息源及文章数量',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const db = getDb()
  if (!db) {
    return {
      content: [{ type: 'text', text: '数据库未找到，请先启动 Feed Hub 并抓取内容' }],
      isError: true,
    }
  }

  try {
    const { name, arguments: args } = request.params

    if (name === 'search_articles') {
      const { query, limit = 10 } = args
      const articles = db.prepare(`
        SELECT a.id, a.title, a.url, a.summary, a.author, a.published_at,
               s.name as source_name
        FROM articles_fts
        JOIN articles a ON a.id = articles_fts.rowid
        JOIN sources s ON s.id = a.source_id
        WHERE articles_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(String(query), Math.min(Number(limit), 50))

      if (articles.length === 0) {
        return { content: [{ type: 'text', text: `未找到与「${query}」相关的文章` }] }
      }

      const text = articles.map((a, i) =>
        `${i + 1}. **${a.title}**\n   来源: ${a.source_name} | ${a.published_at?.slice(0, 10) || '未知日期'}\n   ${a.summary?.slice(0, 150) || ''}${a.url ? `\n   链接: ${a.url}` : ''}`
      ).join('\n\n')

      return { content: [{ type: 'text', text: `搜索「${query}」找到 ${articles.length} 篇：\n\n${text}` }] }
    }

    if (name === 'get_recent_articles') {
      const { source_name, days = 7, limit = 20 } = args
      const dateThreshold = new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10)

      let articles
      if (source_name) {
        articles = db.prepare(`
          SELECT a.title, a.url, a.summary, a.published_at, s.name as source_name
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE s.name LIKE ? AND COALESCE(a.published_at, a.fetched_at) >= ?
          ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
          LIMIT ?
        `).all(`%${source_name}%`, dateThreshold, Math.min(Number(limit), 50))
      } else {
        articles = db.prepare(`
          SELECT a.title, a.url, a.summary, a.published_at, s.name as source_name
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE COALESCE(a.published_at, a.fetched_at) >= ?
          ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
          LIMIT ?
        `).all(dateThreshold, Math.min(Number(limit), 50))
      }

      if (articles.length === 0) {
        return { content: [{ type: 'text', text: `最近 ${days} 天暂无新文章` }] }
      }

      const text = articles.map((a, i) =>
        `${i + 1}. **${a.title}**\n   ${a.source_name} | ${a.published_at?.slice(0, 10) || ''}${a.url ? `\n   ${a.url}` : ''}`
      ).join('\n\n')

      return { content: [{ type: 'text', text: `最近 ${days} 天共 ${articles.length} 篇：\n\n${text}` }] }
    }

    if (name === 'list_sources') {
      const sources = db.prepare(`
        SELECT s.name, s.type, COUNT(a.id) as count, s.last_fetched_at
        FROM sources s LEFT JOIN articles a ON a.source_id = s.id
        WHERE s.enabled = 1
        GROUP BY s.id ORDER BY count DESC
      `).all()

      const text = sources.map(s =>
        `- ${s.name} (${s.type === 'wechat' ? '公众号' : 'RSS'}) — ${s.count} 篇，最后更新 ${s.last_fetched_at?.slice(0, 10) || '从未'}`
      ).join('\n')

      return { content: [{ type: 'text', text: `已订阅 ${sources.length} 个来源：\n\n${text}` }] }
    }

    return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true }
  } finally {
    db.close()
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
