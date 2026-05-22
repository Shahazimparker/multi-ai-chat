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
import { Bot, User, Copy, Check, Zap, Download, Clock, FileText, ExternalLink } from 'lucide-react';
import api from '../../config/api';
import './MessageBubble.css';

// ── File languages that trigger file-card UI ─────────────────
const FILE_LANGUAGES = new Set([
  'html','htm','js','jsx','ts','tsx','css','scss','sass','less',
  'json','xml','yaml','yml','md','csv','svg','txt','log',
  'py','rb','php','java','c','cpp','h','hpp','cs','go','rs','swift',
  'kt','sql','r','sh','bash','ps1','bat','pl','lua',
  'xlsx','xls','doc','docx','pdf','ppt','pptx',
]);

// ── Helpers ──────────────────────────────────────────────────

/** Format ISO timestamp to readable time */
const formatTime = (iso) => {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};


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

// ── FileCard — renders a downloadable file from AI-generated code ──
const FileCard = ({ file, onDownload }) => {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [fetchedContent, setFetchedContent] = React.useState(null);
  const isHtml = file.file_type === 'html' || file.file_name?.endsWith('.html');
  const displayContent = file.content || fetchedContent || '';

  const togglePreview = () => {
    const opening = !previewOpen;
    setPreviewOpen(opening);
    // Fetch content from server if file has file_id but no local content
    if (opening && !file.content && !fetchedContent && file.file_id) {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      fetch(`/upload/preview/${file.file_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => setFetchedContent(data.content || ''))
        .catch(() => setFetchedContent('[Preview unavailable]'));
    }
  };

  return (
    <div className="file-card-wrap">
      <div className="file-card">
        <div className="file-card-icon-wrap">
          <FileText size={20} />
        </div>
        <div className="file-card-info">
          <span className="file-card-name">{file.file_name}</span>
          <span className="file-card-type">{file.file_type?.toUpperCase() || 'FILE'}</span>
        </div>
        <div className="file-card-actions">
          <button
            className={`file-card-btn preview-btn ${previewOpen ? 'active' : ''}`}
            onClick={togglePreview}
            title="Preview"
          >
            <ExternalLink size={13} />
          </button>
          <button className="file-card-btn" onClick={() => onDownload(file)} title="Download">
            <Download size={13} />
          </button>
        </div>
      </div>
      {previewOpen && (
        <div className="file-preview-inline">
          {isHtml ? (
            <iframe
              srcDoc={displayContent}
              title={file.file_name}
              sandbox="allow-scripts"
              className="file-preview-iframe"
            />
          ) : (
            <pre className="file-preview-code">{displayContent || 'Loading...'}</pre>
          )}
        </div>
      )}
    </div>
  );
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

const MessageBubble = ({ message, onSidebarRefresh }) => {
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
  const fileCodeBlockIdx = React.useRef(0);
  tableIdx.current = 0;
  csvIdx.current = 0;
  fileCodeBlockIdx.current = 0;

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

        // If this code block language is a file type, show as FileCard
        if (FILE_LANGUAGES.has(lang)) {
          const idx = fileCodeBlockIdx.current++;
          // Prefer server-backed file if available, else build client-side file object
          const serverFile = message.generatedFiles?.[idx];
          const fileName = serverFile?.file_name || `generated.${lang}`;
          const file = serverFile
            ? { ...serverFile, content: serverFile.content || codeText }
            : { file_name: fileName, file_type: lang, content: codeText };
          const handleDownload = (f) => {
            if (f.file_id) {
              const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
              fetch(`/upload/download/${f.file_id}`, {
                headers: { Authorization: `Bearer ${token}` },
              })
                .then(res => {
                  if (!res.ok) return Promise.reject();
                  const cd = res.headers.get('Content-Disposition');
                  const filenameMatch = cd?.match(/filename="?(.+?)"?$/);
                  return res.blob().then(blob => ({ blob, filename: filenameMatch?.[1] }));
                })
                .then(({ blob, filename }) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = filename || f.file_name || 'file';
                  a.click();
                  URL.revokeObjectURL(url);
                })
                .catch(() => alert('Download failed'));
            } else {
              downloadFile(f.content, f.file_name, 'text/plain;charset=utf-8');
            }
          };
          return <FileCard file={file} onDownload={handleDownload} />;
        }

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
  }), [tableCSVList, csvCodeBlocks, message.generatedFiles]);

  // Download helper for generated files
  const handleFileDownload = async (f) => {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    try {
      const res = await fetch(`/upload/download/${f.file_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return alert('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use the Content-Disposition filename from server if available
      const cd = res.headers.get('Content-Disposition');
      const match = cd && cd.match(/filename="?(.+?)"?$/);
      a.download = match ? match[1] : (f.file_name || 'file');
      a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Download failed'); }
  };

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

        {/* Generated files section */}
        {message.generatedFiles?.length > 0 && (
          <div className="generated-files-section">
            <div className="generated-files-label">Generated Files</div>
            <div className="generated-files-list">
              {message.generatedFiles.map((f, i) => (
                <FileCard
                  key={f.file_id || i}
                  file={f}
                  onDownload={handleFileDownload}
                />
              ))}
            </div>
          </div>
        )}
        
        {message.streaming && <span className="cursor">|</span>}

        {/* Copy button + timestamp — bottom of bubble */}
        <div className="bubble-footer">
          <span className="msg-timestamp">
            <Clock size={11} />
            {message.created_at && formatTime(message.created_at)}
          </span>
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
