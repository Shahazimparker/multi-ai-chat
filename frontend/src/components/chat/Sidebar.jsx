// ============================================================
// FILE: frontend/src/components/chat/Sidebar.jsx
// PURPOSE: Left sidebar — New Chat, collapsible Chats & Artifacts
//          sections top, Recent chats below divider, user footer.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PlusCircle, MessageSquare, Trash2, Pencil, Check, X, LogOut, Settings, FileText, Clock, ChevronRight, Search, Download, Database } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../layout/ThemeToggle';
import api from '../../config/api';
import './Sidebar.css';

const RECENT_COUNT = 3;

const Sidebar = ({ activeTopic, onTopicSelect, onNewChat, refreshTrigger }) => {
  const { user, logout }      = useAuth();
  const navigate              = useNavigate();
  const [topics,  setTopics]  = useState([]);
  const [editing, setEditing] = useState(null);
  const [editVal, setEditVal] = useState('');

  // Collapse state — collapsed by default
  const [chatsOpen, setChatsOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactSearch, setArtifactSearch] = useState('');

  const [artifacts, setArtifacts] = useState([]);

  // ── Sidebar resize ──
  const sidebarRef = useRef(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const isResizing = useRef(false);

  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeMouseMove = useCallback((e) => {
    if (!isResizing.current) return;
    const newWidth = Math.max(200, Math.min(500, e.clientX));
    setSidebarWidth(newWidth);
  }, []);

  const handleResizeMouseUp = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleResizeMouseMove);
      document.removeEventListener('mouseup', handleResizeMouseUp);
    };
  }, [handleResizeMouseMove, handleResizeMouseUp]);

  // ── Artifact preview / download ──
  const handleArtifactPreview = useCallback(async (art) => {
    try {
      const res = await api.get(`/upload/preview/${art.id}`);
      const data = res.data;
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        const safe = (str) => str
          .replace(/&/g, '&')
          .replace(/</g, '<')
          .replace(/>/g, '>')
          .replace(/"/g, '"');
        newWindow.document.write(`
          <!DOCTYPE html>
          <html><head><meta charset="utf-8">
          <title>${safe(data.file_name)}</title>
          <style>
            body { background:#0d1117; color:#c9d1d9; font-family:monospace; padding:24px; margin:0; }
            pre { white-space:pre-wrap; word-wrap:break-word; max-width:100%; }
            h2 { color:#a78bfa; font-family:sans-serif; margin-bottom:12px; }
            .meta { color:#8b949e; font-size:12px; margin-bottom:20px; }
          </style>
          </head><body>
          <h2>${safe(data.file_name)}</h2>
          <div class="meta">Type: ${safe(data.file_type || '—')}</div>
          <pre>${safe(data.content || 'No content available')}</pre>
          </body></html>
        `);
        newWindow.document.close();
      }
    } catch (err) {
      console.error('[Artifact] Preview failed:', err);
    }
  }, []);

  const handleArtifactDownload = useCallback(async (e, art) => {
    e.stopPropagation();
    try {
      const res = await api.get(`/upload/download/${art.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers?.['content-disposition'];
      const match = cd && cd.match(/filename="?(.+?)"?$/);
      a.download = match ? match[1] : art.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Artifact] Download failed:', err);
    }
  }, []);

  const handleArtifactDelete = useCallback(async (e, art) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${art.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/upload/${art.id}`);
      setArtifacts(prev => prev.filter(a => a.id !== art.id));
    } catch (err) {
      console.error('[Artifact] Delete failed:', err);
      alert('Failed to delete file');
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get('/upload/files')
      .then(res => {
        const fileList = res.data?.files || [];
        setArtifacts(fileList.map(f => ({
          id: f.file_id,
          name: f.file_name,
          size: f.file_type || '',
          created_at: f.created_at,
        })));
      })
      .catch(() => {});
  }, [user, refreshTrigger]);

  useEffect(() => {
    if (!user) return;
    api.get('/history/topics')
      .then(res => setTopics(res.data.topics || []))
      .catch(() => {});
  }, [user, refreshTrigger]);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation?')) return;
    await api.delete(`/history/topics/${id}`);
    setTopics(p => p.filter(t => t.id !== id));
    if (activeTopic?.id === id) onNewChat();
    // Refresh artifacts — topic deletion also removes associated generated files from DB
    try {
      const res = await api.get('/upload/files');
      const fileList = res.data?.files || [];
      setArtifacts(fileList.map(f => ({
        id: f.file_id,
        name: f.file_name,
        size: f.file_type || '',
        created_at: f.created_at,
      })));
    } catch {}
  };

  const startEdit = (e, topic) => {
    e.stopPropagation();
    setEditing(topic.id);
    setEditVal(topic.title);
  };

  const saveEdit = async (id) => {
    if (!editVal.trim()) return;
    await api.patch(`/history/topics/${id}`, { title: editVal.trim() });
    setTopics(p => p.map(t => t.id === id ? { ...t, title: editVal.trim() } : t));
    setEditing(null);
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const recentTopics = topics.slice(0, RECENT_COUNT);

  const filteredArtifacts = artifacts.filter(a =>
    a.name.toLowerCase().includes(artifactSearch.toLowerCase())
  );

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleResizeMouseDown}
      />
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-logo">✦ Miles Intelligence</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ThemeToggle />
          {user?.role === 'admin' && (
            <button className="admin-btn" onClick={() => navigate('/admin')} title="Admin Panel">
              <Settings size={15} />
            </button>
          )}
        </div>
      </div>

      {/* ─── TOP SCROLLABLE SECTION ─── */}
      <div className="sidebar-top-section">

        <button className="new-chat-btn" onClick={onNewChat}>
          <PlusCircle size={16} />
          New Chat
        </button>

        <button className="knowledge-nav-btn" onClick={() => navigate('/knowledge')}>
          <Database size={15} />
          <span>Knowledge Bases</span>
        </button>

        {/* ── Chats section (collapsible) ── */}
        <div className="sidebar-section">
          <div className="sidebar-section-label collapsible" onClick={() => setChatsOpen(!chatsOpen)}>
            <ChevronRight size={13} className={`collapse-arrow ${chatsOpen ? 'open' : ''}`} />
            <MessageSquare size={13} />
            <span>Chats</span>
          </div>
          {chatsOpen && (
            <div className="sidebar-items">
              {topics.length === 0 ? (
                <p className="sidebar-empty-msg">No conversations yet</p>
              ) : (
                topics.map(topic => (
                  <div
                    key={topic.id}
                    className={`topic-item ${activeTopic?.id === topic.id ? 'active' : ''}`}
                    onClick={() => onTopicSelect(topic)}
                  >
                    <MessageSquare size={14} className="topic-icon" />
                    <div className="topic-content">
                      {editing === topic.id ? (
                        <div className="edit-row" onClick={e => e.stopPropagation()}>
                          <input
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveEdit(topic.id);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            autoFocus
                          />
                          <button onClick={() => saveEdit(topic.id)}><Check size={12}/></button>
                          <button onClick={() => setEditing(null)}><X size={12}/></button>
                        </div>
                      ) : (
                        <>
                          <span className="topic-title">{topic.title}</span>
                          <span className="topic-model">{topic.model}</span>
                        </>
                      )}
                    </div>
                    {editing !== topic.id && (
                      <div className="topic-actions">
                        <button onClick={e => startEdit(e, topic)} title="Rename"><Pencil size={12}/></button>
                        <button className="topic-del-btn" onClick={e => handleDelete(e, topic.id)} title="Delete"><Trash2 size={12}/></button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ── Artifacts section (collapsible, with search) ── */}
        <div className="sidebar-section">
          <div className="sidebar-section-label collapsible" onClick={() => setArtifactsOpen(!artifactsOpen)}>
            <ChevronRight size={13} className={`collapse-arrow ${artifactsOpen ? 'open' : ''}`} />
            <FileText size={13} />
            <span>Artifacts</span>
          </div>
          {artifactsOpen && (
            <div className="sidebar-items">
              <div className="artifact-search-wrap">
                <Search size={13} className="artifact-search-icon" />
                <input
                  type="text"
                  className="artifact-search-input"
                  placeholder="Search docs..."
                  value={artifactSearch}
                  onChange={e => setArtifactSearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
              {filteredArtifacts.length === 0 ? (
                <p className="sidebar-empty-msg">No matching docs</p>
              ) : (
                filteredArtifacts.map(art => (
                  <div key={art.id} className="artifact-item" onClick={() => handleArtifactPreview(art)}>
                    <FileText size={14} className="artifact-icon" />
                    <div className="artifact-content">
                      <span className="artifact-name">{art.name}</span>
                      <span className="artifact-size">{art.size}</span>
                    </div>
                    <div className="artifact-actions">
                      <button className="artifact-dl-btn" onClick={e => handleArtifactDownload(e, art)} title="Download">
                        <Download size={12} />
                      </button>
                      <button className="artifact-del-btn" onClick={e => handleArtifactDelete(e, art)} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* ─── DIVIDER ─── */}
        <div className="sidebar-divider" />

        {/* ─── RECENT SECTION ─── */}
        <div className="sidebar-recent-section">
          <div className="sidebar-section-label">
            <Clock size={13} />
            <span>Recent</span>
          </div>
          <div className="sidebar-items">
            {recentTopics.length === 0 ? (
              <p className="sidebar-empty-msg">No recent chats</p>
            ) : (
              recentTopics.map(topic => (
                <div
                  key={topic.id}
                  className={`topic-item ${activeTopic?.id === topic.id ? 'active' : ''}`}
                  onClick={() => onTopicSelect(topic)}
                >
                  <MessageSquare size={14} className="topic-icon" />
                  <div className="topic-content">
                    {editing === topic.id ? (
                      <div className="edit-row" onClick={e => e.stopPropagation()}>
                        <input
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveEdit(topic.id);
                            if (e.key === 'Escape') setEditing(null);
                          }}
                          autoFocus
                        />
                        <button onClick={() => saveEdit(topic.id)}><Check size={12}/></button>
                        <button onClick={() => setEditing(null)}><X size={12}/></button>
                      </div>
                    ) : (
                      <>
                        <span className="topic-title">{topic.title}</span>
                        <span className="topic-model">{topic.model}</span>
                      </>
                    )}
                  </div>
                  {editing !== topic.id && (
                    <div className="topic-actions">
                      <button onClick={e => startEdit(e, topic)} title="Rename"><Pencil size={12}/></button>
                      <button className="topic-del-btn" onClick={e => handleDelete(e, topic.id)} title="Delete"><Trash2 size={12}/></button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>

      {/* User footer */}
      <div className="sidebar-footer">
        <div className="user-info">
          <div className="user-avatar">{user?.username?.[0]?.toUpperCase()}</div>
          <div className="user-details">
            <span className="user-name">{user?.username}</span>
            <span className="user-role">{user?.role}</span>
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout} title="Logout">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
