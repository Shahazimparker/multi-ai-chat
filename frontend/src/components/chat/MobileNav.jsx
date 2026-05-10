// ============================================================
// FILE: frontend/src/components/chat/MobileNav.jsx
// PURPOSE: Mobile navigation drawer with hamburger menu
//          Shows new chat, topics, user info, logout
// NOTE: This file already exists – just replace its contents
// ============================================================

import React, { useState, useEffect } from 'react';
import {
    Menu,
    X,
    PlusCircle,
    MessageSquare,
    LogOut,
    Settings,
    Trash2,
    Pencil,
    Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../../config/api';
import './MobileNav.css';

const MobileNav = ({
    activeTopic,
    onTopicSelect,
    onNewChat,
    refreshTrigger,
}) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [topics, setTopics] = useState([]);
    const [editing, setEditing] = useState(null);
    const [editVal, setEditVal] = useState('');

    /* -------------------------------------------------
       Load topics whenever the user changes or a refresh
       ------------------------------------------------- */
    useEffect(() => {
        if (!user) return;
        api
            .get('/history/topics')
            .then((res) => setTopics(res.data.topics || []))
            .catch(() => { });
    }, [user, refreshTrigger]);

    /* -------------------------------------------------
       Handlers (delete, edit, new chat, logout …)
       ------------------------------------------------- */
    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm('Delete this conversation?')) return;
        await api.delete(`/history/topics/${id}`);
        setTopics((p) => p.filter((t) => t.id !== id));
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
        setTopics((p) =>
            p.map((t) => (t.id === id ? { ...t, title: editVal.trim() } : t))
        );
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

    return (
        <>
            {/* -------------------------------------------------
          Hamburger button – always visible on mobile
          ------------------------------------------------- */}
            <button
                className="mobile-menu-toggle"
                onClick={() => setIsOpen(!isOpen)}
                title={isOpen ? 'Close menu' : 'Open menu'}
            >
                {isOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* -------------------------------------------------
          Overlay – dark background that appears when drawer is open
          ------------------------------------------------- */}
            {isOpen && (
                <div
                    className="mobile-drawer-overlay"
                    onClick={() => setIsOpen(false)}
                />
            )}

            {/* -------------------------------------------------
          Drawer panel
          ------------------------------------------------- */}
            <div className={`mobile-drawer ${isOpen ? 'open' : ''}`}>
                {/* ------------------- Header ------------------- */}
                <div className="mobile-drawer-header">
                    <span className="drawer-title">✦ Azim's AI</span>

                    {/* Model selector – native <select> (you can replace with a custom UI) */}
                    <select defaultValue="gpt-4">
                        <option value="gpt-4">GPT‑4</option>
                        <option value="gpt-3.5">GPT‑3.5</option>
                    </select>

                    <button
                        className="drawer-close-btn"
                        onClick={() => setIsOpen(false)}
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* ------------------- Body (scrollable) ------------------- */}
                <div className="mobile-drawer-body">
                    {/* New‑Chat button – stays at the top of the scrollable area */}
                    <button className="mobile-new-chat-btn" onClick={handleNewChat}>
                        <PlusCircle size={16} />
                        New Chat
                    </button>

                    {/* Topics list */}
                    <div className="mobile-topics-list">
                        {topics.length === 0 ? (
                            <p className="mobile-no-topics">No conversations yet</p>
                        ) : (
                            <>
                                <p className="mobile-topics-header">Conversations</p>
                                {topics.map((topic) => (
                                    <div
                                        key={topic.id}
                                        className={`mobile-topic-item ${activeTopic?.id === topic.id ? 'active' : ''
                                            }`}
                                        onClick={() => handleTopicClick(topic)}
                                    >
                                        {/* Icon */}
                                        <MessageSquare
                                            size={14}
                                            className="mobile-topic-icon"
                                        />

                                        {/* Title / Model */}
                                        <div className="mobile-topic-content">
                                            {editing === topic.id ? (
                                                <div
                                                    className="mobile-edit-row"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        value={editVal}
                                                        onChange={(e) => setEditVal(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') saveEdit(topic.id);
                                                            if (e.key === 'Escape') setEditing(null);
                                                        }}
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => saveEdit(topic.id)}
                                                        title="Save"
                                                    >
                                                        <Check size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditing(null)}
                                                        title="Cancel"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <span className="mobile-topic-title">
                                                        {topic.title}
                                                    </span>
                                                    <span className="mobile-topic-model">
                                                        {topic.model}
                                                    </span>
                                                </>
                                            )}
                                        </div>

                                        {/* Edit / Delete actions (only when not editing) */}
                                        {editing !== topic.id && (
                                            <div className="mobile-topic-actions">
                                                <button
                                                    onClick={(e) => startEdit(e, topic)}
                                                    title="Rename"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={(e) => handleDelete(e, topic.id)}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </div>

                {/* ------------------- Footer ------------------- */}
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

                        {/* Admin button – only show for admins */}
                        {user?.role === 'admin' && (
                            <button
                                className="mobile-admin-btn"
                                onClick={() => {
                                    navigate('/admin');
                                    setIsOpen(false);
                                }}
                                title="Admin Panel"
                            >
                                <Settings size={18} />
                            </button>
                        )}
                    </div>

                    {/* Logout – now always visible above the bottom safe‑area */}
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