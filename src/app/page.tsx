'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Source = {
  id: number
  name: string
  type: 'rss' | 'wechat' | 'podcast'
  url: string
  enabled: number
  last_fetched_at: string | null
  article_count: number
}

type Article = {
  id: number
  title: string
  url: string | null
  summary: string | null
  content: string | null
  transcription: string | null
  author: string | null
  published_at: string | null
  source_name: string
  source_type: string
  audio_url: string | null
  transcription_status: string
  // AI meta
  summary_ai: string | null
  content_type: string | null
  time_horizon: string | null
  signal_type: string | null
  sector: string | null
  processed_at: string | null
  factors_raw: string | null
  section_outline: string | null
  golden_quotes: string | null
  word_count: number | null
  reading_minutes: number | null
  tags_raw: string | null
  title_snippet?: string
  summary_snippet?: string
}

// 标签分类 → 前端样式（skill：标签按分类差异化展示）
const TAG_CATEGORY_STYLES: Record<string, string> = {
  market:      'bg-blue-50 text-blue-600',
  sector:      'bg-orange-50 text-orange-600',
  theme:       'bg-gray-100 text-gray-600',
  style:       'bg-indigo-50 text-indigo-600',
  person:      'bg-teal-50 text-teal-600',
  institution: 'bg-purple-50 text-purple-600',
  other:       'bg-gray-50 text-gray-400',
  topic:       'bg-gray-100 text-gray-600', // 旧数据兼容
}

function parseTagsRaw(raw: string | null): { name: string; category: string }[] {
  if (!raw) return []
  return raw.split('||').map(pair => {
    const i = pair.indexOf(':')
    if (i === -1) return { name: pair, category: 'other' }
    return { category: pair.slice(0, i), name: pair.slice(i + 1) }
  }).filter(t => t.name)
}

const CONTENT_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  news:          { label: '资讯', cls: 'bg-gray-100 text-gray-500' },
  analysis:      { label: '分析', cls: 'bg-blue-50 text-blue-600' },
  education:     { label: '投教', cls: 'bg-teal-50 text-teal-600' },
  opinion:       { label: '观点', cls: 'bg-yellow-50 text-yellow-600' },
  data_report:   { label: '数据', cls: 'bg-orange-50 text-orange-600' },
  strategy_note: { label: '策略', cls: 'bg-indigo-50 text-indigo-600' },
}

const SIGNAL_LABELS: Record<string, { label: string; cls: string }> = {
  bullish: { label: '看多', cls: 'bg-green-50 text-green-600' },
  bearish: { label: '看空', cls: 'bg-red-50 text-red-600' },
  neutral: { label: '中性', cls: 'bg-gray-100 text-gray-500' },
}

const FACTOR_LABELS: Record<string, string> = {
  value: '价值', momentum: '动量', quality: '质量', size: '规模',
  low_vol: '低波', macro: '宏观', carry: '套利', growth: '成长', other: '其他',
}

type Tag = { id: number; name: string; category: string; count: number }

const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  wechat:   { label: '公众号', cls: 'bg-green-50 text-green-600' },
  rss:      { label: 'RSS',    cls: 'bg-blue-50 text-blue-600' },
  podcast:  { label: '播客',   cls: 'bg-purple-50 text-purple-600' },
  obsidian: { label: 'Ob',     cls: 'bg-violet-50 text-violet-600' },
  twitter:  { label: 'X',      cls: 'bg-gray-900 text-white' },
}

const EDITOR_TEMPLATE = `# 标题：写下你的文章标题

副标题或一句话导读

---

这里是导语段落。简短有力，点出本文核心问题或观察。

## 01 第一节标题

正文段落。支持**加粗关键词**，可以在段落中直接强调重点内容。

1. 第一个要点
2. 第二个要点
3. 第三个要点

> **核心结论**：用引用块高亮最重要的判断或结论。

## 02 第二节标题

正文内容。

| 对比项 | 方案 A | 方案 B |
|--------|--------|--------|
| 指标 1 | 数值   | 数值   |

## 03 结论

总结段落。回应导语提出的问题，给出明确判断。

---

*作者：你的名字 | 日期*
`

const SNIPPETS = [
  { label: '+ 大标题', text: '\n## 0X 节标题\n\n' },
  { label: '+ 引用块', text: '\n> **核心结论**：\n\n' },
  { label: '+ 表格', text: '\n| 列1 | 列2 | 列3 |\n|-----|-----|-----|\n| 内容 | 内容 | 内容 |\n\n' },
  { label: '+ 图片', text: '\n![图注](图片URL)\n\n' },
  { label: '+ 列表', text: '\n1. 要点一\n2. 要点二\n3. 要点三\n\n' },
  { label: '+ 分割线', text: '\n---\n\n' },
]

export default function Home() {
  const [tab, setTab] = useState<'articles' | 'sources' | 'editor' | 'wechat'>('articles')

  // Feed state
  const [sources, setSources] = useState<Source[]>([])
  const [articles, setArticles] = useState<Article[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedSource, setSelectedSource] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', type: 'rss', url: '' })
  const [adding, setAdding] = useState(false)
  const [fetchMsg, setFetchMsg] = useState('')
  const [transcribing, setTranscribing] = useState<Record<number, boolean>>({})
  const [processing, setProcessing] = useState<Record<number, boolean>>({})
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedTag, setSelectedTag] = useState<number | null>(null)
  const [tagsExpanded, setTagsExpanded] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [configSaving, setConfigSaving] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)

  // Transcription expand state
  const [expandedTranscription, setExpandedTranscription] = useState<Record<number, boolean>>({})
  const [expandedSummary, setExpandedSummary] = useState<Record<number, boolean>>({})

  // Editor state
  const [md, setMd] = useState(EDITOR_TEMPLATE)
  const [copied, setCopied] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Draft state
  type Draft = { id: number; title: string; preview: string; updated_at: string }
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('无标题')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSources = useCallback(async () => {
    const res = await fetch('/api/sources')
    setSources(await res.json())
  }, [])

  const loadTags = useCallback(async () => {
    const res = await fetch('/api/tags')
    setTags(await res.json())
  }, [])

  const loadArticles = useCallback(async () => {
    if (query) {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=20`)
      const data = await res.json()
      setArticles(data.articles)
      setTotal(data.total)
    } else {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (selectedSource) params.set('source_id', String(selectedSource))
      if (selectedTag) params.set('tag_id', String(selectedTag))
      const res = await fetch(`/api/articles?${params}`)
      const data = await res.json()
      setArticles(data.articles)
      setTotal(data.total)
    }
  }, [query, page, selectedSource, selectedTag])

  useEffect(() => { loadSources() }, [loadSources])
  useEffect(() => { loadTags() }, [loadTags])
  useEffect(() => { loadArticles() }, [loadArticles])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(searchInput)
    setPage(1)
  }

  const handleFetchAll = async () => {
    setFetching(true)
    setFetchMsg('')
    const res = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    const inserted = data.reduce((s: number, r: { inserted: number }) => s + r.inserted, 0)
    setFetchMsg(`抓取完成，新增 ${inserted} 条`)
    setFetching(false)
    loadSources()
    loadArticles()
  }

  const handleFetchOne = async (id: number) => {
    setFetching(true)
    const res = await fetch('/api/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: id }),
    })
    const data = await res.json()
    setFetchMsg(`新增 ${data.inserted} 条`)
    setFetching(false)
    loadSources()
    loadArticles()
  }

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    if (res.ok) {
      setAddForm({ name: '', type: 'rss', url: '' })
      loadSources()
    } else {
      const err = await res.json()
      alert(err.error)
    }
    setAdding(false)
  }

  const handleDeleteSource = async (id: number) => {
    if (!confirm('删除该订阅源（文章不会删除）？')) return
    await fetch(`/api/sources/${id}`, { method: 'DELETE' })
    loadSources()
  }

  const handleToggleSource = async (id: number, enabled: number) => {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    })
    loadSources()
  }

  const loadConfig = useCallback(async () => {
    const res = await fetch('/api/settings')
    setConfigValues(await res.json())
  }, [])

  const handleSaveConfig = async () => {
    setConfigSaving(true)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configValues),
    })
    setConfigSaving(false)
    setConfigSaved(true)
    setTimeout(() => setConfigSaved(false), 2000)
    loadConfig()
  }

  useEffect(() => { if (configOpen) loadConfig() }, [configOpen, loadConfig])

  const loadDrafts = useCallback(async () => {
    const res = await fetch('/api/drafts')
    setDrafts(await res.json())
  }, [])

  useEffect(() => { if (tab === 'editor') loadDrafts() }, [tab, loadDrafts])

  const autoSave = useCallback((title: string, content: string, draftId: number | null) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (draftId) {
        await fetch(`/api/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
      } else {
        const res = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
        const draft = await res.json()
        setCurrentDraftId(draft.id)
      }
      loadDrafts()
    }, 1000)
  }, [loadDrafts])

  const handleNewDraft = async () => {
    const res = await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '无标题', content: EDITOR_TEMPLATE }),
    })
    const draft = await res.json()
    setCurrentDraftId(draft.id)
    setDraftTitle(draft.title)
    setMd(draft.content)
    loadDrafts()
  }

  const handleLoadDraft = async (id: number) => {
    const res = await fetch(`/api/drafts/${id}`)
    const draft = await res.json()
    setCurrentDraftId(draft.id)
    setDraftTitle(draft.title)
    setMd(draft.content)
  }

  const handleDeleteDraft = async (id: number) => {
    if (!confirm('删除该草稿？')) return
    await fetch(`/api/drafts/${id}`, { method: 'DELETE' })
    if (currentDraftId === id) handleNewDraft()
    loadDrafts()
  }

  const handleMdChange = (val: string) => {
    setMd(val)
    autoSave(draftTitle, val, currentDraftId)
  }

  const handleTitleChange = (val: string) => {
    setDraftTitle(val)
    autoSave(val, md, currentDraftId)
  }

  const handleTranscribe = async (articleId: number) => {
    setTranscribing(t => ({ ...t, [articleId]: true }))
    await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId }),
    })
    const poll = setInterval(async () => {
      const res = await fetch(`/api/transcribe/status?id=${articleId}`)
      const data = await res.json()
      if (data.status !== 'processing') {
        clearInterval(poll)
        setTranscribing(t => ({ ...t, [articleId]: false }))
        loadArticles()
      }
    }, 3000)
  }

  const handleProcess = async (articleId: number) => {
    setProcessing(p => ({ ...p, [articleId]: true }))
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId }),
    })
    setProcessing(p => ({ ...p, [articleId]: false }))
    if (res.ok) {
      // 直接拉这篇文章的最新字段，就地更新 state，不依赖整页刷新
      const updated = await fetch(`/api/articles/${articleId}`)
      if (updated.ok) {
        const fresh: Article = await updated.json()
        setArticles(prev => prev.map(a => a.id === articleId ? { ...a, ...fresh } : a))
      }
      loadTags()
    }
  }

  // Editor handlers
  const insertSnippet = useCallback((text: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const newVal = md.slice(0, start) + text + md.slice(end)
    setMd(newVal)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    }, 0)
  }, [md])

  const handleCopy = async () => {
    if (!previewRef.current) return
    try {
      const html = previewRef.current.innerHTML
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([md], { type: 'text/plain' }),
        })
      ])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-0 w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Feed Hub</h1>
            <p className="text-sm text-gray-500 mt-0.5">投研信息聚合知识库</p>
          </div>
          <button
            onClick={handleFetchAll}
            disabled={fetching}
            className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {fetching ? '抓取中...' : '全部更新'}
          </button>
        </div>

        {fetchMsg && (
          <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg">
            {fetchMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {([
            ['articles', `文章 (${total})`],
            ['sources', `订阅源 (${sources.length})`],
            ['wechat', '公众号入库'],
            ['editor', '写文章'],
          ] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                tab === t ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab !== 'editor' && tab !== 'wechat' && (
        <div className="max-w-5xl mx-auto px-4 py-6 w-full">
          {tab === 'articles' && (
            <div className="flex gap-6">
              <div className="w-44 shrink-0 space-y-4">
                {/* Tag filter */}
                <div>
                  <button
                    onClick={() => setTagsExpanded(e => !e)}
                    className="flex items-center justify-between w-full text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 hover:text-gray-600"
                  >
                    <span>标签</span>
                    <span className="text-gray-300 normal-case tracking-normal font-normal">
                      {tagsExpanded ? '收起' : tags.length > 0 ? `${tags.length} 个` : ''}
                    </span>
                  </button>

                  {tags.length === 0 && (
                    <p className="text-[11px] text-gray-300 px-1 leading-relaxed">
                      AI 分析文章后<br />标签将出现在这里
                    </p>
                  )}

                  {tags.length > 0 && (
                    <div className="space-y-0.5">
                      {selectedTag && (
                        <button
                          onClick={() => { setSelectedTag(null); setPage(1) }}
                          className="w-full text-left px-3 py-1.5 text-xs rounded-md bg-gray-100 font-medium flex items-center justify-between"
                        >
                          <span className="truncate">{tags.find(t => t.id === selectedTag)?.name}</span>
                          <span className="text-gray-400 ml-1 shrink-0">✕</span>
                        </button>
                      )}
                      {(tagsExpanded ? tags : tags.slice(0, selectedTag ? 0 : 5)).map(t => (
                        t.id === selectedTag ? null :
                        <button
                          key={t.id}
                          onClick={() => { setSelectedTag(t.id); setSelectedSource(null); setPage(1) }}
                          className="w-full text-left px-3 py-1.5 text-xs rounded-md hover:bg-gray-50 flex items-center justify-between"
                        >
                          <span className="truncate text-gray-600">{t.name}</span>
                          <span className="text-gray-300 text-[10px] ml-1 shrink-0">{t.count}</span>
                        </button>
                      ))}
                      {!tagsExpanded && tags.length > 5 && (
                        <button
                          onClick={() => setTagsExpanded(true)}
                          className="w-full text-left px-3 py-1 text-[11px] text-gray-400 hover:text-gray-600"
                        >
                          + 展开全部 {tags.length} 个标签
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Source filter */}
                <div>
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">来源</div>
                  <ul className="space-y-0.5">
                    <li>
                      <button
                        onClick={() => { setSelectedSource(null); setSelectedTag(null); setPage(1) }}
                        className={`w-full text-left px-3 py-1.5 text-sm rounded-md ${!selectedSource && !selectedTag ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}
                      >
                        全部
                      </button>
                    </li>
                    {sources.map(s => (
                      <li key={s.id}>
                        <button
                          onClick={() => { setSelectedSource(s.id); setSelectedTag(null); setPage(1) }}
                          className={`w-full text-left px-3 py-1.5 text-sm rounded-md truncate ${selectedSource === s.id ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'}`}
                        >
                          {s.name}
                          <span className="ml-1 text-gray-400 text-xs">({s.article_count})</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 模型配置 */}
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <button
                    onClick={() => setConfigOpen(o => !o)}
                    className="flex items-center justify-between w-full text-xs font-medium text-gray-400 uppercase tracking-wider hover:text-gray-600"
                  >
                    <span>模型配置</span>
                    <span>{configOpen ? '▲' : '▼'}</span>
                  </button>
                  {configOpen && (
                    <div className="mt-3 space-y-4">
                      {/* AI 分析模型 */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">AI 分析</p>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">厂商</label>
                          <select
                            value={configValues['AI_VENDOR'] || ''}
                            onChange={e => {
                              const vendors: Record<string, { url: string; model: string }> = {
                                moonshot: { url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
                                openai:   { url: 'https://api.openai.com/v1',  model: 'gpt-4o-mini' },
                                anthropic: { url: 'https://api.anthropic.com/v1', model: 'claude-haiku-4-5-20251001' },
                                deepseek:  { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
                                custom:    { url: '', model: '' },
                              }
                              const v = vendors[e.target.value]
                              setConfigValues(prev => ({
                                ...prev,
                                AI_VENDOR: e.target.value,
                                ...(v && e.target.value !== 'custom' ? { AI_BASE_URL: v.url, AI_MODEL: v.model } : {}),
                              }))
                            }}
                            className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400 bg-white"
                          >
                            <option value="">选择厂商…</option>
                            <option value="moonshot">Moonshot (Kimi)</option>
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic (Claude)</option>
                            <option value="deepseek">DeepSeek</option>
                            <option value="custom">自定义</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">模型</label>
                          <input type="text" value={configValues['AI_MODEL'] || ''} onChange={e => setConfigValues(v => ({ ...v, AI_MODEL: e.target.value }))} placeholder="moonshot-v1-8k" className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400 font-mono" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">API Key</label>
                          <input type="text" value={configValues['AI_API_KEY'] || ''} onChange={e => setConfigValues(v => ({ ...v, AI_API_KEY: e.target.value }))} placeholder="sk-..." className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400 font-mono" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">Base URL</label>
                          <input type="text" value={configValues['AI_BASE_URL'] || ''} onChange={e => setConfigValues(v => ({ ...v, AI_BASE_URL: e.target.value }))} placeholder="https://api.moonshot.cn/v1" className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400 font-mono" />
                        </div>
                      </div>
                      {/* 语音转写 */}
                      <div className="space-y-2 pt-2 border-t border-gray-100">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">语音转写 · 阿里云 DashScope</p>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">API Key</label>
                          <input type="text" value={configValues['DASHSCOPE_API_KEY'] || ''} onChange={e => setConfigValues(v => ({ ...v, DASHSCOPE_API_KEY: e.target.value }))} placeholder="sk-..." className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400 font-mono" />
                        </div>
                      </div>
                      <button
                        onClick={handleSaveConfig}
                        disabled={configSaving}
                        className="w-full text-xs py-1.5 bg-black text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
                      >
                        {configSaved ? '已保存 ✓' : configSaving ? '保存中…' : '保存'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <form onSubmit={handleSearch} className="flex gap-2 mb-5">
                  <input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="搜索标题、摘要、正文、转写内容..."
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400"
                  />
                  <button type="submit" className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800">搜索</button>
                  {query && (
                    <button type="button" onClick={() => { setQuery(''); setSearchInput(''); setPage(1) }}
                      className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">清除</button>
                  )}
                </form>

                <div className="space-y-3">
                  {articles.length === 0 && (
                    <p className="text-gray-400 text-sm py-12 text-center">暂无内容，请先在「订阅源」tab 添加并更新</p>
                  )}
                  {articles.map(a => {
                    const srcMeta = SOURCE_LABELS[a.source_type] || SOURCE_LABELS.rss
                    const isPodcast = a.source_type === 'podcast' || !!a.audio_url
                    const ctMeta = a.content_type ? CONTENT_TYPE_LABELS[a.content_type] : null
                    const sigMeta = a.signal_type ? SIGNAL_LABELS[a.signal_type] : null
                    const factors = a.factors_raw
                      ? a.factors_raw.split(',').map(f => { const [n, d] = f.split(':'); return { name: n, dir: d } })
                      : []
                    const displaySummary = a.summary_ai || a.summary_snippet || a.summary
                    return (
                      <div key={a.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            {a.source_type === 'twitter' ? (
                              // Twitter 推文：无标题，直接展示内容
                              <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
                                {a.summary || a.content?.slice(0, 280) || ''}
                              </p>
                            ) : (
                              <>
                                {a.url ? (
                                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                                    className="font-medium text-sm hover:underline leading-snug block"
                                    dangerouslySetInnerHTML={{ __html: a.title_snippet || a.title || '' }}
                                  />
                                ) : (
                                  <p className="font-medium text-sm leading-snug"
                                    dangerouslySetInnerHTML={{ __html: a.title_snippet || a.title || '' }}
                                  />
                                )}
                                {isPodcast ? (
                                  (a.content || a.summary) && (
                                    <div className="text-xs mt-1.5 text-gray-500 prose prose-xs max-w-none leading-relaxed"
                                      dangerouslySetInnerHTML={{ __html: a.content || a.summary || '' }}
                                    />
                                  )
                                ) : (
                                  displaySummary && (
                                    <div className="mt-1.5">
                                      {a.summary_ai && (a.word_count || a.reading_minutes) && (
                                        <p className="text-[10px] text-gray-400 mb-0.5">
                                          {a.word_count ? `全文约 ${a.word_count} 字` : ''}
                                          {a.word_count && a.reading_minutes ? ' · ' : ''}
                                          {a.reading_minutes ? `阅读约 ${a.reading_minutes} 分钟` : ''}
                                        </p>
                                      )}
                                      <p className={`text-xs ${expandedSummary[a.id] ? '' : 'line-clamp-5'} ${a.summary_ai ? 'text-gray-600' : 'text-gray-400'}`}
                                        dangerouslySetInnerHTML={{ __html: a.summary_snippet || displaySummary }}
                                      />
                                      {expandedSummary[a.id] && (() => {
                                        let outline: { heading: string; summary: string }[] = []
                                        let quotes: string[] = []
                                        try { outline = a.section_outline ? JSON.parse(a.section_outline) : [] } catch { /* 旧数据 */ }
                                        try { quotes = a.golden_quotes ? JSON.parse(a.golden_quotes) : [] } catch { /* 旧数据 */ }
                                        return (
                                          <>
                                            {outline.length > 0 && (
                                              <div className="mt-2 border-l-2 border-gray-200 pl-2.5 space-y-1">
                                                {outline.map((o, i) => (
                                                  <p key={i} className="text-xs text-gray-500">
                                                    <span className="font-medium text-gray-600">{o.heading}</span>
                                                    {o.summary ? ` — ${o.summary}` : ''}
                                                  </p>
                                                ))}
                                              </div>
                                            )}
                                            {quotes.length > 0 && (
                                              <div className="mt-2 space-y-1">
                                                {quotes.map((q, i) => (
                                                  <p key={i} className="text-xs text-amber-700/80 bg-amber-50/60 rounded px-2 py-1">「{q}」</p>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )
                                      })()}
                                      {a.summary_ai && a.summary_ai.length > 120 && (
                                        <button
                                          onClick={() => setExpandedSummary(s => ({ ...s, [a.id]: !s[a.id] }))}
                                          className="text-[10px] text-gray-400 hover:text-gray-600 mt-0.5"
                                        >
                                          {expandedSummary[a.id] ? '收起' : '展开'}
                                        </button>
                                      )}
                                    </div>
                                  )
                                )}
                              </>
                            )}
                            {factors.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {factors.map(f => (
                                  <span key={f.name + f.dir}
                                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                      f.dir === 'positive' ? 'bg-green-50 text-green-600' :
                                      f.dir === 'negative' ? 'bg-red-50 text-red-500' :
                                      'bg-gray-100 text-gray-500'
                                    }`}>
                                    {FACTOR_LABELS[f.name] || f.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {(() => {
                              const articleTags = parseTagsRaw(a.tags_raw)
                              if (articleTags.length === 0) return null
                              const shown = expandedSummary[a.id] ? articleTags : articleTags.slice(0, 10)
                              return (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {shown.map(t => (
                                    <span key={t.category + t.name}
                                      className={`text-[10px] px-1.5 py-0.5 rounded ${TAG_CATEGORY_STYLES[t.category] || TAG_CATEGORY_STYLES.other}`}>
                                      {t.name}
                                    </span>
                                  ))}
                                  {!expandedSummary[a.id] && articleTags.length > 10 && (
                                    <span className="text-[10px] px-1 py-0.5 text-gray-400">+{articleTags.length - 10}</span>
                                  )}
                                </div>
                              )
                            })()}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {isPodcast && a.transcription_status !== 'done' && (
                              <button
                                onClick={() => handleTranscribe(a.id)}
                                disabled={transcribing[a.id] || a.transcription_status === 'processing'}
                                className="text-xs px-2.5 py-1.5 border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                {transcribing[a.id] || a.transcription_status === 'processing' ? '转写中…' : '转写'}
                              </button>
                            )}
                            {isPodcast && a.transcription_status === 'done' && (
                              <button
                                onClick={() => setExpandedTranscription(s => ({ ...s, [a.id]: !s[a.id] }))}
                                className="text-xs px-2.5 py-1.5 bg-purple-50 text-purple-500 rounded-lg hover:bg-purple-100"
                              >
                                {expandedTranscription[a.id] ? '收起文稿' : '查看文稿'}
                              </button>
                            )}
                            {!a.processed_at ? (
                              <button
                                onClick={() => handleProcess(a.id)}
                                disabled={processing[a.id]}
                                className="text-xs px-2.5 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                              >
                                {processing[a.id] ? 'AI 处理中…' : 'AI 分析'}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleProcess(a.id)}
                                disabled={processing[a.id]}
                                className="text-xs px-2.5 py-1.5 text-gray-300 hover:text-gray-400 disabled:opacity-50 whitespace-nowrap"
                                title="重新分析"
                              >
                                {processing[a.id] ? '处理中…' : '↺'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2.5 text-xs text-gray-400 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${srcMeta.cls}`}>{srcMeta.label}</span>
                          {ctMeta && <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${ctMeta.cls}`}>{ctMeta.label}</span>}
                          {sigMeta && <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${sigMeta.cls}`}>{sigMeta.label}</span>}
                          {a.sector && <span className="text-gray-400">{a.sector}</span>}
                          <span>{a.source_name}</span>
                          {a.author && <span>{a.author}</span>}
                          {a.published_at && <span>{a.published_at.slice(0, 10)}</span>}
                        </div>
                        {expandedTranscription[a.id] && a.transcription && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-[11px] text-gray-400 mb-1.5 font-medium">文字稿</p>
                            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{a.transcription}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {!query && totalPages > 1 && (
                  <div className="flex items-center gap-2 mt-6 justify-center">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">上一页</button>
                    <span className="text-sm text-gray-500">{page} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">下一页</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'sources' && (
            <div className="max-w-2xl">
              <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
                <h2 className="font-medium text-sm mb-4">添加订阅源</h2>
                <form onSubmit={handleAddSource} className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 mb-1 block">名称</label>
                      <input
                        value={addForm.name}
                        onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. 半导体行业观察"
                        required
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400"
                      />
                    </div>
                    <div className="w-28">
                      <label className="text-xs text-gray-500 mb-1 block">类型</label>
                      <select
                        value={addForm.type}
                        onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400 bg-white"
                      >
                        <option value="rss">RSS</option>
                        <option value="wechat">公众号</option>
                        <option value="podcast">播客</option>
                        <option value="twitter">Twitter/X</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">RSS / Feed URL</label>
                    <input
                      value={addForm.url}
                      onChange={e => setAddForm(f => ({ ...f, url: e.target.value }))}
                      placeholder="https://..."
                      required
                      type="url"
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400"
                    />
                  </div>
                  <p className="text-xs text-gray-400">播客填小宇宙 Feed URL：https://feeds.xiaoyuzhoufm.com/podcast/&lt;id&gt;</p>
                  <button type="submit" disabled={adding}
                    className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">
                    {adding ? '添加中...' : '添加'}
                  </button>
                </form>
              </div>

              <div className="space-y-2">
                {sources.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">还没有订阅源</p>}
                {sources.map(s => {
                  const srcMeta = SOURCE_LABELS[s.type] || SOURCE_LABELS.rss
                  return (
                    <div key={s.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{s.name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${srcMeta.cls}`}>{srcMeta.label}</span>
                          <span className="text-xs text-gray-400">{s.article_count} 条</span>
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-0.5">{s.url}</p>
                        {s.last_fetched_at && <p className="text-xs text-gray-300 mt-0.5">上次更新 {s.last_fetched_at.slice(0, 16)}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleFetchOne(s.id)} disabled={fetching}
                          className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">更新</button>
                        <button onClick={() => handleToggleSource(s.id, s.enabled)}
                          className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">
                          {s.enabled ? '启用中' : '已暂停'}
                        </button>
                        <button onClick={() => handleDeleteSource(s.id)}
                          className="text-xs px-2.5 py-1.5 text-red-400 border border-red-100 rounded-lg hover:bg-red-50">删除</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WeWeRSS tab — full height iframe */}
      {tab === 'wechat' && (
        <div className="flex flex-1 overflow-hidden">
          <iframe
            src="https://rss.feedhubs.org"
            className="flex-1 border-0"
            allow="clipboard-write"
          />
        </div>
      )}

      {/* Editor tab — full height */}
      {tab === 'editor' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Draft sidebar */}
          <div className="w-48 shrink-0 border-r border-gray-100 bg-gray-50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-500">草稿</span>
              <button onClick={handleNewDraft}
                className="text-xs text-gray-400 hover:text-gray-700 px-1.5 py-0.5 rounded hover:bg-gray-200">
                + 新建
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {drafts.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-4 text-center">暂无草稿</p>
              )}
              {drafts.map(d => (
                <div key={d.id}
                  className={`group px-3 py-2.5 cursor-pointer border-b border-gray-100 hover:bg-white ${currentDraftId === d.id ? 'bg-white border-l-2 border-l-black' : ''}`}
                  onClick={() => handleLoadDraft(d.id)}
                >
                  <p className="text-xs font-medium text-gray-700 truncate">{d.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">{d.preview?.slice(0, 40) || '空'}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-gray-300">{d.updated_at?.slice(5, 16)}</span>
                    <button onClick={e => { e.stopPropagation(); handleDeleteDraft(d.id) }}
                      className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100">
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Main editor area */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-100 shrink-0">
              <input
                value={draftTitle}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="草稿标题"
                className="text-sm font-medium outline-none text-gray-800 placeholder-gray-300 w-40"
              />
              <div className="w-px h-4 bg-gray-200" />
              {SNIPPETS.map(s => (
                <button key={s.label} onClick={() => insertSnippet(s.text)}
                  className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap">
                  {s.label}
                </button>
              ))}
              <div className="flex-1" />
              {(() => {
                // 与 processor 口径一致：中文按字、英文按词，400字/分钟
                const plain = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>\-\[\]()!|]/g, ' ')
                const cjk = (plain.match(/[一-鿿]/g) || []).length
                const words = (plain.replace(/[一-鿿]/g, ' ').match(/[a-zA-Z0-9]+/g) || []).length
                const count = cjk + words
                return count > 0 ? (
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">
                    {count} 字 · 约 {Math.max(1, Math.round(count / 400))} 分钟
                  </span>
                ) : null
              })()}
              <span className="text-[10px] text-gray-300">
                {currentDraftId ? `草稿 #${currentDraftId}` : '未保存'}
              </span>
              <button onClick={handleCopy}
                className="text-xs px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800">
                {copied ? '已复制 ✓' : '复制富文本'}
              </button>
            </div>

            {/* Editor + Preview */}
            <div className="flex flex-1 overflow-hidden">
              <div className="w-1/2 flex flex-col border-r border-gray-200">
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-400">Markdown</div>
                <textarea
                  ref={textareaRef}
                  value={md}
                  onChange={e => handleMdChange(e.target.value)}
                  className="flex-1 p-5 text-sm font-mono leading-relaxed resize-none outline-none bg-white text-gray-800"
                  spellCheck={false}
                />
              </div>
              <div className="w-1/2 overflow-y-auto bg-white">
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-400 sticky top-0">预览</div>
                <div ref={previewRef} className="px-10 py-8 max-w-2xl mx-auto article-preview">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .article-preview {
          font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;
          font-size: 15px; line-height: 1.8; color: #333;
        }
        .article-preview h1 { font-size: 22px; font-weight: bold; line-height: 1.4; margin: 0 0 8px 0; color: #111; }
        .article-preview h2 { font-size: 17px; font-weight: bold; margin: 32px 0 12px 0; color: #111; padding-left: 10px; border-left: 3px solid #111; }
        .article-preview h3 { font-size: 15px; font-weight: bold; margin: 20px 0 8px 0; color: #333; }
        .article-preview p { margin: 0 0 16px 0; text-align: justify; }
        .article-preview strong { font-weight: bold; color: #111; }
        .article-preview blockquote { margin: 20px 0; padding: 12px 16px; background: #f7f7f7; border-left: 3px solid #555; border-radius: 2px; color: #444; }
        .article-preview blockquote p { margin: 0; }
        .article-preview ol, .article-preview ul { padding-left: 20px; margin: 0 0 16px 0; }
        .article-preview li { margin-bottom: 6px; }
        .article-preview table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
        .article-preview th { background: #f0f0f0; font-weight: bold; padding: 8px 12px; border: 1px solid #ddd; text-align: left; }
        .article-preview td { padding: 8px 12px; border: 1px solid #ddd; }
        .article-preview tr:nth-child(even) td { background: #fafafa; }
        .article-preview img { max-width: 100%; margin: 12px 0 4px 0; border-radius: 4px; }
        .article-preview hr { border: none; border-top: 1px solid #eee; margin: 28px 0; }
        .article-preview code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-size: 13px; }
        .article-preview em { color: #888; font-style: normal; font-size: 13px; }
      `}</style>
    </div>
  )
}
