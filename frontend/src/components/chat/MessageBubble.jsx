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
import { Bot, User, Copy, Check, Zap, Download, Clock, FileText, Image, ChevronDown, ChevronUp, BookOpen, ExternalLink } from 'lucide-react';
import api from '../../config/api';
import ApprovalPrompt from './ApprovalPrompt';
import ClarificationPrompt from './ClarificationPrompt';
import ReasoningPanel from './ReasoningPanel';
import './MessageBubble.css';

// ── File languages that trigger file-card UI ─────────────────

// ── Helpers ──────────────────────────────────────────────────

/** Format ISO timestamp to readable date & time, e.g. "Today, 7:48 PM" or "Aug 25, 7:48 PM" */
const formatDateTime = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    if (isToday) {
      return `Today, ${timeStr}`;
    }
    if (isYesterday) {
      return `Yesterday, ${timeStr}`;
    }
    const isSameYear = d.getFullYear() === now.getFullYear();
    const dateStr = d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      ...(isSameYear ? {} : { year: 'numeric' }),
    });
    return `${dateStr}, ${timeStr}`;
  } catch { return ''; }
};

/** Format ISO timestamp to full localized date/time for tooltip */
const formatFullDateTime = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
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

const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

// ── FileCard — renders a downloadable file from AI-generated code ──
const FileCard = ({ file, onDownload }) => {
  const [expanded, setExpanded] = React.useState(false);
  const [fetchedContent, setFetchedContent] = React.useState(null);
  const [imageUrl, setImageUrl] = React.useState(null);

  const ext = (file.file_type || file.file_name?.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_TYPES.has(ext);
  const isHtml = ext === 'html' || ext === 'htm';
  const displayContent = file.content || fetchedContent || '';

  // For images: build a blob URL from the download endpoint on expand
  React.useEffect(() => {
    if (!expanded || !file.file_id) return;
    if (isImage && !imageUrl) {
      api.get(`/upload/download/${file.file_id}`, { responseType: 'blob' })
        .then(res => setImageUrl(URL.createObjectURL(res.data)))
        .catch(() => setImageUrl(null));
    }
    if (!isImage && !file.content && !fetchedContent) {
      api.get(`/upload/preview/${file.file_id}`)
        .then(res => setFetchedContent(res.data?.content || ''))
        .catch(() => setFetchedContent('[Preview unavailable]'));
    }
  }, [expanded, file.file_id, file.content, fetchedContent, isImage, imageUrl]);

  // Revoke blob URL on unmount to avoid memory leaks
  React.useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  return (
    <div className="file-card-wrap">
      <div className="file-card">
        <div className="file-card-icon-wrap">
          {isImage ? <Image size={20} /> : <FileText size={20} />}
        </div>
        <div className="file-card-info">
          <span className="file-card-name">{file.file_name}</span>
          <span className="file-card-type">{(file.file_type || ext).toUpperCase() || 'FILE'}</span>
        </div>
        <div className="file-card-actions">
          <button
            className={`file-card-btn expand-btn ${expanded ? 'active' : ''}`}
            onClick={() => setExpanded(p => !p)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button className="file-card-btn" onClick={() => onDownload(file)} title="Download">
            <Download size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="file-preview-inline">
          {isImage ? (
            imageUrl
              ? <img src={imageUrl} alt={file.file_name} className="file-preview-image" />
              : <div className="file-preview-loading">Loading preview…</div>
          ) : isHtml ? (
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
  const [expanded, setExpanded] = React.useState(false);
  const lineCount = React.useMemo(() => code.split('\n').length, [code]);
  const shouldClamp = lineCount > 3;
  const displayCode = shouldClamp && !expanded ? code.split('\n').slice(0, 3).join('\n') : code;

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
        {displayCode}
      </SyntaxHighlighter>
      <div className="code-block-actions">
        {shouldClamp && (
          <button
            className="code-action-btn"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? 'Collapse code' : 'Expand code'}
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
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

// ── CitationsPanel — renders verified reference sources ───────
const CitationsPanel = ({ citations }) => {
  const [expandedId, setExpandedId] = React.useState(null);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="citations-panel">
      <div className="citations-header">
        <BookOpen size={13} />
        <span>Sources & Citations ({citations.length})</span>
      </div>
      <div className="citations-chips">
        {citations.map((c) => {
          const isExpanded = expandedId === c.citationId;
          return (
            <div key={c.citationId} className="citation-chip-wrap">
              <button
                type="button"
                className={`citation-chip ${isExpanded ? 'active' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : c.citationId)}
                title={c.documentTitle}
              >
                <span className="cite-num">[{c.citationId}]</span>
                <span className="cite-name">{c.documentTitle}</span>
                {c.confidence > 0 && <span className="cite-score">{c.confidence}%</span>}
              </button>

              {isExpanded && (
                <div className="citation-popover">
                  <div className="citation-popover-header">
                    <span className="cite-pop-collection">{c.collectionName}</span>
                    {c.sourceUrl && (
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="cite-pop-link">
                        Open URL <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <strong className="cite-pop-title">{c.documentTitle}</strong>
                  {c.sectionTitle && <div className="cite-pop-section">§ {c.sectionTitle}</div>}
                  <p className="cite-pop-snippet">{c.snippet}...</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Component ────────────────────────────────────────────────

const MessageBubble = ({ message, onSidebarRefresh, onApprovalComplete, onClarificationSubmit }) => {
  const [copied, setCopied] = React.useState(false);

  const rawTimestamp = message?.created_at || message?.createdAt || message?.timestamp || message?.time;
  const timeDisplay = React.useMemo(() => formatDateTime(rawTimestamp), [rawTimestamp]);
  const fullTimeTooltip = React.useMemo(() => formatFullDateTime(rawTimestamp), [rawTimestamp]);

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
  }), [tableCSVList, csvCodeBlocks, message.generatedFiles]);

  // Download helper for generated files
  const handleFileDownload = async (f) => {
    try {
      const res = await api.get(`/upload/download/${f.file_id}`, {
        responseType: 'blob',
      });
      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use the Content-Disposition filename from server if available
      const cd = res.headers?.['content-disposition'] || res.headers?.['Content-Disposition'];
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
      
      <div className={`msg-bubble ${message.role}`}>
        {/* Above the status pill and the answer: reasoning precedes both. */}
        {message.role === 'assistant' && message.reasoning && (
          <ReasoningPanel
            reasoning={message.reasoning}
            startedAt={message.reasoningStartedAt}
            elapsedMs={message.reasoningElapsedMs}
            done={message.reasoningDone !== false}
          />
        )}

        {message.statusMessage && (
          <div className="tool-status-pill">
            <span className="tool-status-spinner" />
            <span>{message.statusMessage}</span>
          </div>
        )}

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

        {/* Approval prompt section */}
        {message.approvalRequest && (
          <ApprovalPrompt
            key={message.approvalRequest.id}
            approvalId={message.approvalRequest.id}
            toolType={message.approvalRequest.toolType}
            toolLabel={message.approvalRequest.toolLabel}
            message={message.approvalRequest.message}
            summary={message.approvalRequest.summary}
            onComplete={(result) => onApprovalComplete?.(message.approvalRequest.id, result)}
          />
        )}

        {message.clarificationRequest && (
          <ClarificationPrompt
            request={message.clarificationRequest}
            onSubmit={onClarificationSubmit}
          />
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

        {/* RAG 2.0 Citations section */}
        {message.citations?.length > 0 && (
          <CitationsPanel citations={message.citations} />
        )}
        
        {message.streaming && <span className="cursor">|</span>}

        {/* Actions (left) + timestamp (bottom-right) */}
        <div className="bubble-footer">
          <div className="bubble-footer-actions">
            <button className="copy-btn" onClick={handleCopy} title="Copy message content">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span className="copy-btn-text">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {timeDisplay ? (
            <div className="bubble-footer-right">
              <span className="msg-timestamp" title={fullTimeTooltip}>
                <Clock size={11} className="timestamp-clock-icon" />
                <time dateTime={typeof rawTimestamp === 'string' ? rawTimestamp : undefined}>{timeDisplay}</time>
              </span>
            </div>
          ) : null}
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
