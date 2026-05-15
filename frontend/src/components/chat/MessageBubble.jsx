// ============================================================
// FILE: frontend/src/components/chat/MessageBubble.jsx
// PURPOSE: Renders a single chat message with markdown support
//          Syntax highlighting for code blocks
//          Download CSV buttons for tables & CSV code blocks
// ============================================================

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot, User, Copy, Check, Zap, Download } from 'lucide-react';
import './MessageBubble.css';

// ── Helpers ──────────────────────────────────────────────────

/** Convert a markdown table string → CSV text */
const mdTableToCSV = (tableMd) => {
  const lines = tableMd.trim().split('\n');
  const dataLines = lines.filter(line => !/^\|[\s\-:|]+\|$/.test(line));
  return dataLines.map(line => {
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    return cells
      .map(c => (c.includes(',') || c.includes('"') || c.includes('\n'))
        ? `"${c.replace(/"/g, '""')}"`
        : c)
      .join(',');
  }).join('\n');
};

const downloadFile = (content, filename, mimeType) => {
  const BOM = '\uFEFF'; // Excel UTF-8 compat
  const blob = new Blob([BOM + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ── CodeBlock component (handles its own copy state) ─────────
const CodeBlock = ({ code, language, csvContent, onDownloadCSV }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="code-block-wrapper">
      <SyntaxHighlighter style={vscDarkPlus} language={language} PreTag="div">
        {code}
      </SyntaxHighlighter>
      <div className="code-block-actions">
        <button className="code-action-btn" onClick={handleCopy} title="Copy code">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {csvContent && (
          <button className="code-action-btn" onClick={onDownloadCSV} title="Download as CSV">
            <Download size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

// ── Component ────────────────────────────────────────────────

const MessageBubble = ({ message }) => {
  const [copied, setCopied] = React.useState(false);

  // Pre-parse — extract all markdown tables → CSV
  const tableCSVList = React.useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return [];
    const list = [];
    const tableRegex = /^\|.+\|\s*$(?:\n\|[-: |]+\|\s*$(?:\n\|.+\|\s*$)*)/gm;
    let match;
    while ((match = tableRegex.exec(message.content)) !== null) {
      list.push(mdTableToCSV(match[0]));
    }
    return list;
  }, [message.content]);

  // Pre-parse — extract ```csv code blocks content
  const csvCodeBlocks = React.useMemo(() => {
    if (message.role !== 'assistant' || !message.content) return [];
    const blocks = [];
    const csvRegex = /```csv\n([\s\S]*?)```/g;
    let match;
    while ((match = csvRegex.exec(message.content)) !== null) {
      blocks.push(match[1].trim());
    }
    return blocks;
  }, [message.content]);

  // Counters used inside render (reset each render)
  const tableIdx = React.useRef(0);
  const csvIdx = React.useRef(0);
  tableIdx.current = 0;
  csvIdx.current = 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // ── Custom markdown components ──────────────────────────
  const components = React.useMemo(() => ({
    // Table wrapper with download button
    table({ children, ...props }) {
      const idx = tableIdx.current++;
      const csvData = tableCSVList[idx];
      return (
        <div className="table-container">
          <div className="table-scroll">
            <table {...props}>{children}</table>
          </div>
          {csvData && (
            <button
              className="dl-btn dl-csv-btn"
              onClick={() => downloadFile(csvData, 'table.csv', 'text/csv;charset=utf-8')}
              title="Download as CSV"
            >
              <Download size={12} />
              CSV
            </button>
          )}
        </div>
      );
    },
    // Code block — copy button on every block + CSV download for ```csv
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : null;

      if (!inline && match) {
        const codeText = String(children).replace(/\n$/, '');

        if (lang === 'csv') {
          const idx = csvIdx.current++;
          const content = csvCodeBlocks[idx];
          return (
            <CodeBlock
              code={codeText}
              language="csv"
              csvContent={content}
              onDownloadCSV={() => downloadFile(content, 'data.csv', 'text/csv;charset=utf-8')}
            />
          );
        }

        return <CodeBlock code={codeText} language={lang} />;
      }

      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  }), [tableCSVList, csvCodeBlocks]);

  return (
    <div className={`message-row ${message.role}`}>
      <div className={`msg-avatar ${message.role}`}>
        {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
      </div>
      
      <div className="msg-bubble">
        {message.role === 'assistant' ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={components}
          >
            {message.content}
          </ReactMarkdown>
        ) : (
          message.content
        )}
        
        {message.streaming && <span className="cursor">|</span>}

        {/* Copy button — bottom of bubble, always visible */}
        <div className="bubble-footer">
          <button className="copy-btn" onClick={handleCopy} title="Copy entire message">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <div className="msg-info">
        {message.tokensUsed && (
          <div className="meta">
            <Zap size={12} />
            {message.tokensUsed} tokens
            {message.cacheHit && ' (Cached)'}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(MessageBubble);