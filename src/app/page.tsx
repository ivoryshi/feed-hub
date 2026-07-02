'use client'

import { useState, useEffect, useCallback } from 'react'

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
  author: string | null
  published_at: string | null
  source_name: string
  source_type: string
  audio_url: string | null
  transcription_status: string
  title_snippet?: string
  summary_snippet?: string
}

const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  wechat:  { label: '公众号', cls: 'bg-green-50 text-green-600' },
  rss:     { label: 'RSS',    cls: 'bg-blue-50 text-blue-600' },
  podcast: { label: '播客',   cls: 'bg-purple-50 text-purple-600' },
}

const TRANSCRIPTION_LABELS: Record<string, string> = {
  none:       '转写',
  processing: '转写中…',
  done:       '已转写',
  error:      '转写失败，重试',
}

export default function Home() {
  const [tab, setTab] = useState<'articles' | 'sources'>('articles')
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

  const loadSources = useCallback(async () => {
    const res = await fetch('/api/sources')
    setSources(await res.json())
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
      const res = await fetch(`/api/articles?${params}`)
      const data = await res.json()
      setArticles(data.articles)
      setTotal(data.total)
    }
  }, [query, page, selectedSource])

  useEffect(() => { loadSources() }, [loadSources])
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

  const handleTranscribe = async (articleId: number) => {
    setTranscribing(t => ({ ...t, [articleId]: true }))
    await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: articleId }),
    })
    // 轮询状态
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

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
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
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['articles', 'sources'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'articles' ? `文章 (${total})` : `订阅源 (${sources.length})`}
          </button>
        ))}
      </div>

      {tab === 'articles' && (
        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-44 shrink-0">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">来源</div>
            <ul className="space-y-1">
              <li>
                <button
                  onClick={() => { setSelectedSource(null); setPage(1) }}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded-md ${
                    !selectedSource ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                  }`}
                >
                  全部
                </button>
              </li>
              {sources.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => { setSelectedSource(s.id); setPage(1) }}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-md truncate ${
                      selectedSource === s.id ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
                  >
                    {s.name}
                    <span className="ml-1 text-gray-400 text-xs">({s.article_count})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Main */}
          <div className="flex-1 min-w-0">
            <form onSubmit={handleSearch} className="flex gap-2 mb-5">
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="搜索标题、摘要、正文、转写内容..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400"
              />
              <button type="submit" className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800">
                搜索
              </button>
              {query && (
                <button type="button" onClick={() => { setQuery(''); setSearchInput(''); setPage(1) }}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  清除
                </button>
              )}
            </form>

            <div className="space-y-3">
              {articles.length === 0 && (
                <p className="text-gray-400 text-sm py-12 text-center">暂无内容，请先在「订阅源」tab 添加并更新</p>
              )}
              {articles.map(a => {
                const srcMeta = SOURCE_LABELS[a.source_type] || SOURCE_LABELS.rss
                const isPodcast = a.source_type === 'podcast' || !!a.audio_url
                return (
                  <div key={a.id} className="bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noopener noreferrer"
                            className="font-medium text-sm hover:underline leading-snug block"
                            dangerouslySetInnerHTML={{ __html: a.title_snippet || a.title }}
                          />
                        ) : (
                          <p className="font-medium text-sm leading-snug"
                            dangerouslySetInnerHTML={{ __html: a.title_snippet || a.title }}
                          />
                        )}
                        {(a.summary_snippet || a.summary) && (
                          <p className="text-xs text-gray-500 mt-1.5 line-clamp-2"
                            dangerouslySetInnerHTML={{ __html: a.summary_snippet || a.summary || '' }}
                          />
                        )}
                      </div>
                      {/* 播客转写按钮 */}
                      {isPodcast && a.transcription_status !== 'done' && (
                        <button
                          onClick={() => handleTranscribe(a.id)}
                          disabled={transcribing[a.id] || a.transcription_status === 'processing'}
                          className="shrink-0 text-xs px-2.5 py-1.5 border border-purple-200 text-purple-600 rounded-lg hover:bg-purple-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          {transcribing[a.id] || a.transcription_status === 'processing'
                            ? '转写中…'
                            : TRANSCRIPTION_LABELS[a.transcription_status] || '转写'}
                        </button>
                      )}
                      {isPodcast && a.transcription_status === 'done' && (
                        <span className="shrink-0 text-xs px-2.5 py-1.5 bg-purple-50 text-purple-400 rounded-lg">✓ 已转写</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2.5 text-xs text-gray-400">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${srcMeta.cls}`}>
                        {srcMeta.label}
                      </span>
                      <span>{a.source_name}</span>
                      {a.author && <span>{a.author}</span>}
                      {a.published_at && <span>{a.published_at.slice(0, 10)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {!query && totalPages > 1 && (
              <div className="flex items-center gap-2 mt-6 justify-center">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                  上一页
                </button>
                <span className="text-sm text-gray-500">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
                  下一页
                </button>
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
              <p className="text-xs text-gray-400">
                播客填小宇宙 Feed URL，格式：https://feeds.xiaoyuzhoufm.com/podcast/&lt;id&gt;
              </p>
              <button type="submit" disabled={adding}
                className="px-4 py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {adding ? '添加中...' : '添加'}
              </button>
            </form>
          </div>

          <div className="space-y-2">
            {sources.length === 0 && (
              <p className="text-gray-400 text-sm py-4 text-center">还没有订阅源</p>
            )}
            {sources.map(s => {
              const srcMeta = SOURCE_LABELS[s.type] || SOURCE_LABELS.rss
              return (
                <div key={s.id} className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${srcMeta.cls}`}>
                        {srcMeta.label}
                      </span>
                      <span className="text-xs text-gray-400">{s.article_count} 条</span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{s.url}</p>
                    {s.last_fetched_at && (
                      <p className="text-xs text-gray-300 mt-0.5">上次更新 {s.last_fetched_at.slice(0, 16)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleFetchOne(s.id)} disabled={fetching}
                      className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
                      更新
                    </button>
                    <button onClick={() => handleToggleSource(s.id, s.enabled)}
                      className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500">
                      {s.enabled ? '启用中' : '已暂停'}
                    </button>
                    <button onClick={() => handleDeleteSource(s.id)}
                      className="text-xs px-2.5 py-1.5 text-red-400 border border-red-100 rounded-lg hover:bg-red-50">
                      删除
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
