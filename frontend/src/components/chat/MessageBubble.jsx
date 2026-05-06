// ============================================================
// FILE: frontend/src/components/chat/MessageBubble.jsx
// PURPOSE: Renders a single chat message with markdown support
//          Syntax highlighting for code blocks
// ============================================================

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot, User, Copy, Check, Zap } from 'lucide-react';
import './MessageBubble.css';

const MessageBubble = ({ message }) => {
  const [copied, setCopied] = React.useState(false);
  const isUser = message.role === 'user';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`message-row ${isUser ? 'user' : 'assistant'}`}>
      {/* Avatar */}
      <div className={`msg-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Bubble */}
      <div className={`msg-bubble ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? (
          <p className="user-text">{message.content}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Syntax highlighted code blocks
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                return !inline && match ? (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={match[1]}
                    PreTag="div"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className="inline-code" {...props}>{children}</code>
                );
              },
              // Open links in new tab
              a({ href, children }) {
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}

        {/* Footer meta */}
        <div className="msg-footer">
          {message.model && (
            <span className="msg-model">{message.model}</span>
          )}
          {message.cacheHit && (
            <span className="cache-badge"><Zap size={10}/> cached</span>
          )}
          {message.tokensUsed > 0 && (
            <span className="token-count">{message.tokensUsed} tokens</span>
          )}
          <button className="copy-btn" onClick={copyToClipboard} title="Copy">
            {copied ? <Check size={11}/> : <Copy size={11}/>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
