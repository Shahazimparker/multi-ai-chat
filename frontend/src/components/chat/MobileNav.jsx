// ============================================================
// FILE: frontend/src/components/chat/MobileNav.jsx
// PURPOSE: Mobile navigation drawer — collapsible Chats & Artifacts
//          sections with search, Recent below divider.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Menu, X, PlusCircle, MessageSquare, LogOut, Settings, Trash2, Pencil, Check, FileText, Clock, ChevronRight, Search, Download } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../../config/api';
import ThemeToggle from '../layout/ThemeToggle';
import './MobileNav.css';

const RECENT_COUNT = 3;

const MobileNav = ({ activeTopic, onTopicSelect, onNewChat, refreshTrigger }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [topics, setTopics] = useState([]);
    const [editing, setEditing] = useState(null);
    const [editVal, setEditVal] = useState('');

    const [chatsOpen, setChatsOpen] = useState(false);
    const [artifactsOpen, setArtifactsOpen] = useState(false);
    const [artifactSearch, setArtifactSearch] = useState('');

    const [artifacts, setArtifacts] = useState([]);

    // ── Artifact preview ──
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
            // Use Content-Disposition filename from server if available
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
            .catch(() => { });
    }, [user, refreshTrigger]);

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm('Delete this conversation?')) return;
        await api.delete(`/history/topics/${id}`);
        setTopics(p => p.filter(t => t.id !== id));
        if (activeTopic?.id === id) onNewChat();
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

    const handleNewChat = () => {
        onNewChat();
        setIsOpen(false);
    };

    const handleTopicClick = (topic) => {
        onTopicSelect(topic);
        setIsOpen(false);
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const recentTopics = topics.slice(0, RECENT_COUNT);
    const filteredArtifacts = artifacts.filter(a =>
        a.name.toLowerCase().includes(artifactSearch.toLowerCase())
    );

    return (
        <>
            <button
                type="button"
                className="mobile-menu-toggle"
                onClick={() => setIsOpen(!isOpen)}
                title={isOpen ? 'Close menu' : 'Open menu'}
                aria-label={isOpen ? 'Close menu' : 'Open menu'}
            >
                {isOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {isOpen && (
                <div
                    className="mobile-drawer-overlay"
                    onClick={() => setIsOpen(false)}
                />
            )}

            <div className={`mobile-drawer ${isOpen ? 'open' : ''}`}>
                <div className="mobile-drawer-header">
                    <span className="drawer-title">✦ Miles Intelligence</span>
                    <div className="mobile-drawer-header-actions">
                        <ThemeToggle />
                        <button
                            type="button"
                            className="drawer-close-btn"
                            onClick={() => setIsOpen(false)}
                            title="Close"
                            aria-label="Close menu"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* ─── TOP SCROLLABLE SECTION ─── */}
                <div className="mobile-top-section">

                    <button type="button" className="mobile-new-chat-btn" onClick={handleNewChat}>
                        <PlusCircle size={16} />
                        New Chat
                    </button>

                    {/* ── Chats section (collapsible) ── */}
                    <div className="mobile-section">
                        <div className="mobile-section-label collapsible" onClick={() => setChatsOpen(!chatsOpen)}>
                            <ChevronRight size={13} className={`collapse-arrow ${chatsOpen ? 'open' : ''}`} />
                            <MessageSquare size={13} />
                            <span>Chats</span>
                        </div>
                        {chatsOpen && (
                            <div className="mobile-section-items">
                                {topics.length === 0 ? (
                                    <p className="mobile-empty-msg">No conversations yet</p>
                                ) : (
                                    topics.map(topic => (
                                        <div
                                            key={topic.id}
                                            className={`mobile-topic-item ${activeTopic?.id === topic.id ? 'active' : ''}`}
                                            onClick={() => handleTopicClick(topic)}
                                        >
                                            <MessageSquare size={14} className="mobile-topic-icon" />
                                            <div className="mobile-topic-content">
                                                {editing === topic.id ? (
                                                    <div className="mobile-edit-row" onClick={e => e.stopPropagation()}>
                                                        <input
                                                            value={editVal}
                                                            onChange={e => setEditVal(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') saveEdit(topic.id);
                                                                if (e.key === 'Escape') setEditing(null);
                                                            }}
                                                            autoFocus
                                                        />
                                                        <button onClick={() => saveEdit(topic.id)} title="Save">
                                                            <Check size={12} />
                                                        </button>
                                                        <button onClick={() => setEditing(null)} title="Cancel">
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <span className="mobile-topic-title">{topic.title}</span>
                                                        <span className="mobile-topic-model">{topic.model}</span>
                                                    </>
                                                )}
                                            </div>
                                            {editing !== topic.id && (
                                                <div className="mobile-topic-actions">
                                                    <button onClick={e => startEdit(e, topic)} title="Rename">
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button onClick={e => handleDelete(e, topic.id)} title="Delete">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Artifacts section (collapsible, with search) ── */}
                    <div className="mobile-section">
                        <div className="mobile-section-label collapsible" onClick={() => setArtifactsOpen(!artifactsOpen)}>
                            <ChevronRight size={13} className={`collapse-arrow ${artifactsOpen ? 'open' : ''}`} />
                            <FileText size={13} />
                            <span>Artifacts</span>
                        </div>
                        {artifactsOpen && (
                            <div className="mobile-section-items">
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
                                    <p className="mobile-empty-msg">No matching docs</p>
                                ) : (
                                    filteredArtifacts.map(art => (
                                                        <div key={art.id} className="mobile-artifact-item" onClick={() => handleArtifactPreview(art)}>
                                                            <FileText size={14} className="mobile-artifact-icon" />
                                                            <div className="mobile-artifact-content">
                                                                <span className="mobile-artifact-name">{art.name}</span>
                                                                <span className="mobile-artifact-size">{art.size}</span>
                                                            </div>
                                                            <div className="mobile-artifact-actions">
                                                                <button
                                                                    className="mobile-artifact-dl-btn"
                                                                    onClick={e => handleArtifactDownload(e, art)}
                                                                    title="Download"
                                                                >
                                                                    <Download size={12} />
                                                                </button>
                                                                <button
                                                                    className="mobile-artifact-del-btn"
                                                                    onClick={e => handleArtifactDelete(e, art)}
                                                                    title="Delete"
                                                                >
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
                    <div className="mobile-divider" />

                    {/* ─── RECENT SECTION ─── */}
                    <div className="mobile-recent-section">
                        <div className="mobile-section-label">
                            <Clock size={13} />
                            <span>Recent</span>
                        </div>
                        <div className="mobile-section-items">
                            {recentTopics.length === 0 ? (
                                <p className="mobile-empty-msg">No recent chats</p>
                            ) : (
                                recentTopics.map(topic => (
                                    <div
                                        key={topic.id}
                                        className={`mobile-topic-item ${activeTopic?.id === topic.id ? 'active' : ''}`}
                                        onClick={() => handleTopicClick(topic)}
                                    >
                                        <MessageSquare size={14} className="mobile-topic-icon" />
                                        <div className="mobile-topic-content">
                                            {editing === topic.id ? (
                                                <div className="mobile-edit-row" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        value={editVal}
                                                        onChange={e => setEditVal(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') saveEdit(topic.id);
                                                            if (e.key === 'Escape') setEditing(null);
                                                        }}
                                                        autoFocus
                                                    />
                                                    <button onClick={() => saveEdit(topic.id)} title="Save">
                                                        <Check size={12} />
                                                    </button>
                                                    <button onClick={() => setEditing(null)} title="Cancel">
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <span className="mobile-topic-title">{topic.title}</span>
                                                    <span className="mobile-topic-model">{topic.model}</span>
                                                </>
                                            )}
                                        </div>
                                        {editing !== topic.id && (
                                            <div className="mobile-topic-actions">
                                                <button onClick={e => startEdit(e, topic)} title="Rename">
                                                    <Pencil size={14} />
                                                </button>
                                                <button onClick={e => handleDelete(e, topic.id)} title="Delete">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>

                <div className="mobile-drawer-footer">
                    <div className="mobile-user-section">
                        <div className="mobile-user-info">
                            <div className="mobile-user-avatar">
                                {user?.username?.[0]?.toUpperCase()}
                            </div>
                            <div className="mobile-user-details">
                                <span className="mobile-user-name">{user?.username}</span>
                                <span className="mobile-user-role">{user?.role}</span>
                            </div>
                        </div>
                        {user?.role === 'admin' && (
                            <button
                                className="mobile-admin-btn"
                                onClick={() => { navigate('/admin'); setIsOpen(false); }}
                                title="Admin Panel"
                            >
                                <Settings size={18} />
                            </button>
                        )}
                    </div>

                    <button
                        className="mobile-logout-btn"
                        onClick={handleLogout}
                        title="Logout"
                    >
                        <LogOut size={16} />
                        Logout
                    </button>
                </div>
            </div>
        </>
    );
};

export default MobileNav;
