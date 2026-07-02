'use client'

import { useState, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TEMPLATE = `# 标题：写下你的文章标题

副标题或一句话导读

---

这里是导语段落。简短有力，点出本文核心问题或观察。一到两句话就够，不需要长篇铺垫。

## 01 第一节标题

正文段落。支持**加粗关键词**，可以在段落中直接强调重点内容。

1. 第一个要点，简洁说明
2. 第二个要点，简洁说明
3. 第三个要点，简洁说明

继续补充这一节的分析内容。数据、案例、逻辑推导都在这里展开。

> **核心结论**：用引用块高亮最重要的判断或结论，读者扫读时能一眼看到。

## 02 第二节标题

正文内容。

| 对比项 | 方案 A | 方案 B |
|--------|--------|--------|
| 指标 1 | 数值   | 数值   |
| 指标 2 | 数值   | 数值   |

![图注文字](https://via.placeholder.com/800x400?text=在此替换图片URL)

## 03 第三节标题

正文内容。

## 04 结论：总结与行动建议

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

export default function EditorPage() {
  const [md, setMd] = useState(TEMPLATE)
  const [copied, setCopied] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      // 降级：复制纯文本
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleNew = () => {
    if (md !== TEMPLATE && !confirm('清空当前内容？')) return
    setMd(TEMPLATE)
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-600 mr-2">← Feed Hub</a>
        <span className="text-sm font-medium text-gray-700">文章编辑器</span>
        <div className="flex-1" />
        {SNIPPETS.map(s => (
          <button
            key={s.label}
            onClick={() => insertSnippet(s.text)}
            className="text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap"
          >
            {s.label}
          </button>
        ))}
        <div className="w-px h-4 bg-gray-200 mx-1" />
        <button onClick={handleNew} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
          新建
        </button>
        <button
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 bg-black text-white rounded-lg hover:bg-gray-800"
        >
          {copied ? '已复制 ✓' : '复制富文本'}
        </button>
      </div>

      {/* Editor + Preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="w-1/2 flex flex-col border-r border-gray-200">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-400">Markdown</div>
          <textarea
            ref={textareaRef}
            value={md}
            onChange={e => setMd(e.target.value)}
            className="flex-1 p-5 text-sm font-mono leading-relaxed resize-none outline-none bg-white text-gray-800"
            spellCheck={false}
            placeholder="开始写作..."
          />
        </div>

        {/* Preview */}
        <div className="w-1/2 overflow-y-auto">
          <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-400 sticky top-0">预览</div>
          <div ref={previewRef} className="px-10 py-8 max-w-2xl mx-auto article-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .article-preview {
          font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;
          font-size: 15px;
          line-height: 1.8;
          color: #333;
        }
        .article-preview h1 {
          font-size: 22px;
          font-weight: bold;
          line-height: 1.4;
          margin: 0 0 8px 0;
          color: #111;
        }
        .article-preview h2 {
          font-size: 17px;
          font-weight: bold;
          margin: 32px 0 12px 0;
          color: #111;
          padding-left: 10px;
          border-left: 3px solid #111;
        }
        .article-preview h3 {
          font-size: 15px;
          font-weight: bold;
          margin: 20px 0 8px 0;
          color: #333;
        }
        .article-preview p {
          margin: 0 0 16px 0;
          text-align: justify;
        }
        .article-preview strong {
          font-weight: bold;
          color: #111;
        }
        .article-preview blockquote {
          margin: 20px 0;
          padding: 12px 16px;
          background: #f7f7f7;
          border-left: 3px solid #555;
          border-radius: 2px;
          color: #444;
        }
        .article-preview blockquote p {
          margin: 0;
        }
        .article-preview ol, .article-preview ul {
          padding-left: 20px;
          margin: 0 0 16px 0;
        }
        .article-preview li {
          margin-bottom: 6px;
        }
        .article-preview table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 14px;
        }
        .article-preview th {
          background: #f0f0f0;
          font-weight: bold;
          padding: 8px 12px;
          border: 1px solid #ddd;
          text-align: left;
        }
        .article-preview td {
          padding: 8px 12px;
          border: 1px solid #ddd;
        }
        .article-preview tr:nth-child(even) td {
          background: #fafafa;
        }
        .article-preview img {
          max-width: 100%;
          margin: 12px 0 4px 0;
          border-radius: 4px;
        }
        .article-preview img + em {
          display: block;
          text-align: center;
          font-size: 12px;
          color: #999;
          margin-bottom: 16px;
        }
        .article-preview hr {
          border: none;
          border-top: 1px solid #eee;
          margin: 28px 0;
        }
        .article-preview code {
          background: #f5f5f5;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 13px;
        }
        .article-preview em {
          color: #888;
          font-style: normal;
          font-size: 13px;
        }
      `}</style>
    </div>
  )
}
