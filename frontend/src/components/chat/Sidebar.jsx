// ============================================================
// FILE: frontend/src/components/chat/Sidebar.jsx
// PURPOSE: Left sidebar — chat topics list, new chat button
//          Rename / delete topics. Shows model used per topic.
// ============================================================

import React, { useState, useEffect } from 'react';
import { PlusCircle, MessageSquare, Trash2, Pencil, Check, X, LogOut, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../config/api';
import './Sidebar.css';

const Sidebar = ({ activeTopic, onTopicSelect, onNewChat, refreshTrigger }) => {
  const { user, logout }     = useAuth();
  const navigate             = useNavigate();
  const [topics,  setTopics] = useState([]);
  const [editing, setEditing] = useState(null); // topic id being renamed
  const [editVal, setEditVal] = useState('');

  // Load topics whenever refreshTrigger changes
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

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <span className="sidebar-logo">✦ MultiAI</span>
        {user?.role === 'admin' && (
          <button className="admin-btn" onClick={() => navigate('/admin')} title="Admin Panel">
            <Settings size={15} />
          </button>
        )}
      </div>

      {/* New chat button */}
      <button className="new-chat-btn" onClick={onNewChat}>
        <PlusCircle size={16} />
        New Chat
      </button>

      {/* Topics list */}
      <div className="topics-list">
        {topics.length === 0 ? (
          <p className="no-topics">No conversations yet</p>
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
                  <button onClick={e => startEdit(e, topic)}  title="Rename"><Pencil size={12}/></button>
                  <button onClick={e => handleDelete(e, topic.id)} title="Delete"><Trash2 size={12}/></button>
                </div>
              )}
            </div>
          ))
        )}
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
