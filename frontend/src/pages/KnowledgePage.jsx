// ============================================================
// FILE: frontend/src/pages/KnowledgePage.jsx
// PURPOSE: Knowledge Management & RAG 2.0 Hub
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder, Plus, Search, Trash2, ArrowLeft, Upload, Globe, FileText,
  CheckCircle2, Clock, AlertCircle, Database, Layers, Eye, RefreshCw, X, Shield, ExternalLink
} from 'lucide-react';
import { useNavigate } from 'react-router';
import api from '../config/api';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/layout/ThemeToggle';
import './KnowledgePage.css';

const KnowledgePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState(null);
  const [collectionDetail, setCollectionDetail] = useState(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCrawlModal, setShowCrawlModal] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showChunkModal, setShowChunkModal] = useState(false);
  const [inspectingChunks, setInspectingChunks] = useState(null);

  // Form states
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [newColPublic, setNewColPublic] = useState(false);
  const [newColColor, setNewColColor] = useState('#4d6bfe');

  // Ingestion form states
  const [uploadFile, setUploadFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState('');
  const [crawlDepth, setCrawlDepth] = useState(2);
  const [crawlMaxPages, setCrawlMaxPages] = useState(15);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/knowledge/collections');
      setCollections(res.data?.collections || []);
    } catch (err) {
      console.error('[KnowledgePage] fetchCollections error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCollectionDetail = useCallback(async (colId) => {
    try {
      const res = await api.get(`/knowledge/collections/${colId}`);
      setCollectionDetail(res.data?.collection || null);
    } catch (err) {
      console.error('[KnowledgePage] fetchCollectionDetail error:', err);
      setActiveCollection(null);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  useEffect(() => {
    if (activeCollection) {
      fetchCollectionDetail(activeCollection.id);
    } else {
      setCollectionDetail(null);
    }
  }, [activeCollection, fetchCollectionDetail]);

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    if (!newColName.trim()) return;

    try {
      setActionLoading(true);
      setErrorMessage('');
      const res = await api.post('/knowledge/collections', {
        name: newColName.trim(),
        description: newColDesc.trim(),
        color: newColColor,
        isPublic: newColPublic,
      });
      setShowCreateModal(false);
      setNewColName('');
      setNewColDesc('');
      await fetchCollections();
      if (res.data?.collection) {
        setActiveCollection(res.data.collection);
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Failed to create collection');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCollection = async (e, colId, colName) => {
    e.stopPropagation();
    if (!window.confirm(`Delete collection "${colName}" and all its documents? This cannot be undone.`)) return;

    try {
      await api.delete(`/knowledge/collections/${colId}`);
      if (activeCollection?.id === colId) {
        setActiveCollection(null);
      }
      await fetchCollections();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete collection');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setUploadFile(e.dataTransfer.files[0]);
      setErrorMessage('');
    }
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!uploadFile || !activeCollection) return;

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      setActionLoading(true);
      setStatusMessage('Ingesting & generating Parent-Child vector embeddings...');
      setErrorMessage('');

      await api.post(`/knowledge/collections/${activeCollection.id}/documents/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setShowUploadModal(false);
      setUploadFile(null);
      setStatusMessage('');
      await fetchCollectionDetail(activeCollection.id);
      await fetchCollections();
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCrawlWebsite = async (e) => {
    e.preventDefault();
    if (!crawlUrl.trim() || !activeCollection) return;

    try {
      setActionLoading(true);
      setStatusMessage(`Crawling & indexing documentation from ${crawlUrl}...`);
      setErrorMessage('');

      const res = await api.post(`/knowledge/collections/${activeCollection.id}/documents/crawl`, {
        url: crawlUrl.trim(),
        maxDepth: Number(crawlDepth),
        maxPages: Number(crawlMaxPages),
      });

      setShowCrawlModal(false);
      setCrawlUrl('');
      setStatusMessage('');
      alert(`Crawl complete! Successfully indexed ${res.data?.indexedCount || 0} pages.`);
      await fetchCollectionDetail(activeCollection.id);
      await fetchCollections();
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Crawl failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddText = async (e) => {
    e.preventDefault();
    if (!textTitle.trim() || !textContent.trim() || !activeCollection) return;

    try {
      setActionLoading(true);
      setStatusMessage('Ingesting note & vectorizing chunks...');
      setErrorMessage('');

      await api.post(`/knowledge/collections/${activeCollection.id}/documents/text`, {
        title: textTitle.trim(),
        content: textContent.trim(),
      });

      setShowTextModal(false);
      setTextTitle('');
      setTextContent('');
      setStatusMessage('');
      await fetchCollectionDetail(activeCollection.id);
      await fetchCollections();
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Text ingestion failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteDocument = async (docId, docTitle) => {
    if (!window.confirm(`Delete document "${docTitle}"?`)) return;
    try {
      await api.delete(`/knowledge/documents/${docId}`);
      if (activeCollection) {
        await fetchCollectionDetail(activeCollection.id);
        await fetchCollections();
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete document');
    }
  };

  const handleInspectChunks = async (docId) => {
    try {
      const res = await api.get(`/knowledge/documents/${docId}/chunks`);
      setInspectingChunks(res.data);
      setShowChunkModal(true);
    } catch (err) {
      alert('Failed to load chunks');
    }
  };

  const filteredCollections = collections.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="knowledge-root">
      {/* Top Navbar */}
      <header className="knowledge-header">
        <div className="header-left">
          <button className="back-chat-btn" onClick={() => navigate('/chat')}>
            <ArrowLeft size={18} />
            <span>Back to Chat</span>
          </button>
          <div className="header-title">
            <Database size={22} className="title-icon" />
            <div>
              <h1>Knowledge Bases (RAG 2.0)</h1>
              <p>Multi-source collections with parent-child indexing, web crawling, and neural search</p>
            </div>
          </div>
        </div>

        <div className="header-right">
          {!activeCollection && (
            <>
              <div className="search-wrap">
                <Search size={16} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search collections..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button className="primary-action-btn" onClick={() => setShowCreateModal(true)}>
                <Plus size={16} />
                <span>New Collection</span>
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="knowledge-main">
        {/* VIEW 1: Collection Grid */}
        {!activeCollection && (
          <div className="collection-view">
            {loading ? (
              <div className="loading-state">
                <RefreshCw size={24} className="spin" />
                <p>Loading knowledge collections...</p>
              </div>
            ) : filteredCollections.length === 0 ? (
              <div className="empty-state">
                <Folder size={48} className="empty-icon" />
                <h3>No Knowledge Collections Found</h3>
                <p>Create your first knowledge collection to index documents, crawl websites, and supercharge AI answers with accurate citations.</p>
                <button className="primary-action-btn" onClick={() => setShowCreateModal(true)}>
                  <Plus size={16} />
                  <span>Create Knowledge Collection</span>
                </button>
              </div>
            ) : (
              <div className="collection-grid">
                {filteredCollections.map((col) => (
                  <div
                    key={col.id}
                    className="collection-card"
                    onClick={() => setActiveCollection(col)}
                  >
                    <div className="card-top">
                      <div className="card-icon" style={{ backgroundColor: `${col.color || '#4d6bfe'}22`, color: col.color || '#4d6bfe' }}>
                        <Folder size={22} />
                      </div>
                      <div className="card-badges">
                        {col.is_public && (
                          <span className="badge public-badge" title="Accessible by all workspace users">
                            <Shield size={11} /> Public
                          </span>
                        )}
                        <span className="badge count-badge">{col.documentCount || 0} docs</span>
                      </div>
                    </div>

                    <h3 className="card-name">{col.name}</h3>
                    <p className="card-desc">{col.description || 'No description provided.'}</p>

                    <div className="card-meta">
                      <div className="meta-stat">
                        <Layers size={13} />
                        <span>{col.chunkCount || 0} chunks</span>
                      </div>
                      <div className="meta-stat">
                        <Clock size={13} />
                        <span>{new Date(col.updated_at).toLocaleDateString()}</span>
                      </div>
                      {col.isOwner && (
                        <button
                          className="delete-card-btn"
                          onClick={(e) => handleDeleteCollection(e, col.id, col.name)}
                          title="Delete collection"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Collection Explorer / Document Manager */}
        {activeCollection && collectionDetail && (
          <div className="explorer-view">
            <div className="explorer-header">
              <button className="back-link" onClick={() => setActiveCollection(null)}>
                <ArrowLeft size={16} />
                <span>All Collections</span>
              </button>

              <div className="explorer-title-row">
                <div className="col-info">
                  <h2>{collectionDetail.name}</h2>
                  <p>{collectionDetail.description || 'Knowledge collection'}</p>
                </div>
                <div className="explorer-actions">
                  <button className="action-btn upload-btn" onClick={() => setShowUploadModal(true)}>
                    <Upload size={15} />
                    <span>Upload Files</span>
                  </button>
                  <button className="action-btn crawl-btn" onClick={() => setShowCrawlModal(true)}>
                    <Globe size={15} />
                    <span>Crawl Web URL</span>
                  </button>
                  <button className="action-btn text-btn" onClick={() => setShowTextModal(true)}>
                    <FileText size={15} />
                    <span>Add Text / Note</span>
                  </button>
                </div>
              </div>

              <div className="collection-stats-bar">
                <div className="stat-pill">
                  <strong>{collectionDetail.documents?.length || 0}</strong> Documents
                </div>
                <div className="stat-pill">
                  <strong>{collectionDetail.documents?.reduce((sum, d) => sum + (d.chunk_count || 0), 0)}</strong> Indexed Chunks
                </div>
                <div className="stat-pill">
                  Embedding Model: <code>{collectionDetail.embedding_model || 'text-embedding-3-small'}</code>
                </div>
              </div>
            </div>

            {/* Documents Table */}
            <div className="docs-table-container">
              {collectionDetail.documents?.length === 0 ? (
                <div className="empty-docs">
                  <FileText size={40} className="empty-icon" />
                  <h4>No Documents in this Collection</h4>
                  <p>Upload PDFs, DOCX, CSVs, or crawl documentation websites to populate this knowledge base.</p>
                </div>
              ) : (
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Document Name</th>
                      <th>Source Type</th>
                      <th>Status</th>
                      <th>Chunks</th>
                      <th>Added On</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collectionDetail.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="doc-title-cell">
                          <FileText size={16} className="doc-icon" />
                          <div>
                            <span className="doc-title">{doc.title}</span>
                            {doc.source_url && (
                              <a href={doc.source_url} target="_blank" rel="noreferrer" className="doc-url">
                                {doc.source_url} <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`source-tag ${doc.source_type}`}>
                            {doc.source_type === 'web_crawl' ? 'Web Crawl' : doc.source_type.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {doc.status === 'indexed' ? (
                            <span className="status-pill status-indexed">
                              <CheckCircle2 size={12} /> Indexed
                            </span>
                          ) : doc.status === 'processing' ? (
                            <span className="status-pill status-processing">
                              <Clock size={12} className="spin" /> Processing
                            </span>
                          ) : (
                            <span className="status-pill status-failed" title={doc.error_message}>
                              <AlertCircle size={12} /> Failed
                            </span>
                          )}
                        </td>
                        <td>{doc.chunk_count || 0}</td>
                        <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="table-actions">
                            <button
                              className="icon-btn"
                              title="Inspect Chunks"
                              onClick={() => handleInspectChunks(doc.id)}
                            >
                              <Eye size={15} />
                            </button>
                            {collectionDetail.isOwner && (
                              <button
                                className="icon-btn delete-btn"
                                title="Delete document"
                                onClick={() => handleDeleteDocument(doc.id, doc.title)}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: Create Collection */}
      {showCreateModal && (
        <div className="km-modal-overlay">
          <div className="km-modal">
            <div className="km-modal-header">
              <h3>Create Knowledge Collection</h3>
              <button className="km-close-btn" onClick={() => setShowCreateModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateCollection}>
              <div className="form-group">
                <label>Collection Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Engineering Docs, HR Policies"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows={3}
                  placeholder="Describe what knowledge this collection holds..."
                  value={newColDesc}
                  onChange={(e) => setNewColDesc(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Accent Color</label>
                <div className="color-picker-row">
                  {['#4d6bfe', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'].map((color) => (
                    <button
                      type="button"
                      key={color}
                      className={`color-chip ${newColColor === color ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewColColor(color)}
                    />
                  ))}
                </div>
              </div>
              {user?.role === 'admin' && (
                <div className="form-group-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={newColPublic}
                      onChange={(e) => setNewColPublic(e.target.checked)}
                    />
                    <span>Make collection public for all users</span>
                  </label>
                </div>
              )}
              {errorMessage && <div className="km-error">{errorMessage}</div>}
              <div className="km-modal-footer">
                <button type="button" className="secondary-btn" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={actionLoading}>
                  {actionLoading ? 'Creating...' : 'Create Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Upload File */}
      {showUploadModal && (
        <div className="km-modal-overlay">
          <div className="km-modal">
            <div className="km-modal-header">
              <h3>Upload Document to {activeCollection?.name}</h3>
              <button className="km-close-btn" onClick={() => setShowUploadModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleUploadDocument}>
              <div
                className={`dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="km-file-upload"
                  onChange={(e) => {
                    setUploadFile(e.target.files[0] || null);
                    setErrorMessage('');
                  }}
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.sql,.yaml,.yml,.zip"
                />
                <label htmlFor="km-file-upload" className="dropzone-label">
                  <Upload size={32} />
                  <span>{uploadFile ? uploadFile.name : 'Click to select or drag a file here'}</span>
                  <small>Supports PDF, DOCX, CSV, Excel, TXT, Markdown, JSON, Code, ZIP</small>
                </label>
              </div>
              {statusMessage && <div className="km-status">{statusMessage}</div>}
              {errorMessage && <div className="km-error">{errorMessage}</div>}
              <div className="km-modal-footer">
                <button type="button" className="secondary-btn" onClick={() => setShowUploadModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={!uploadFile || actionLoading}>
                  {actionLoading ? 'Ingesting...' : 'Ingest & Index'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Crawl Website */}
      {showCrawlModal && (
        <div className="km-modal-overlay">
          <div className="km-modal">
            <div className="km-modal-header">
              <h3>Crawl Website / Docs</h3>
              <button className="km-close-btn" onClick={() => setShowCrawlModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCrawlWebsite}>
              <div className="form-group">
                <label>Documentation / Website Root URL *</label>
                <input
                  type="url"
                  placeholder="https://docs.example.com/api"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  required
                />
                <small className="field-hint">The crawler will traverse internal links from this URL.</small>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Max Crawl Depth: {crawlDepth}</label>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    value={crawlDepth}
                    onChange={(e) => setCrawlDepth(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Max Pages: {crawlMaxPages}</label>
                  <input
                    type="range"
                    min="5"
                    max="30"
                    step="5"
                    value={crawlMaxPages}
                    onChange={(e) => setCrawlMaxPages(e.target.value)}
                  />
                </div>
              </div>
              {statusMessage && <div className="km-status">{statusMessage}</div>}
              {errorMessage && <div className="km-error">{errorMessage}</div>}
              <div className="km-modal-footer">
                <button type="button" className="secondary-btn" onClick={() => setShowCrawlModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={!crawlUrl.trim() || actionLoading}>
                  {actionLoading ? 'Crawling...' : 'Start Crawl'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: Add Text Snippet */}
      {showTextModal && (
        <div className="km-modal-overlay">
          <div className="km-modal">
            <div className="km-modal-header">
              <h3>Add Note or Markdown</h3>
              <button className="km-close-btn" onClick={() => setShowTextModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddText}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Architecture Decisions, API Keys Reference"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Content (Markdown / Plain Text) *</label>
                <textarea
                  rows={8}
                  placeholder="# Enter your markdown text here..."
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  required
                />
              </div>
              {statusMessage && <div className="km-status">{statusMessage}</div>}
              {errorMessage && <div className="km-error">{errorMessage}</div>}
              <div className="km-modal-footer">
                <button type="button" className="secondary-btn" onClick={() => setShowTextModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn" disabled={!textTitle || !textContent || actionLoading}>
                  {actionLoading ? 'Saving...' : 'Index Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: Chunk Inspector */}
      {showChunkModal && inspectingChunks && (
        <div className="km-modal-overlay">
          <div className="km-modal wide-modal">
            <div className="km-modal-header">
              <div>
                <h3>Chunk Inspector: {inspectingChunks.document?.title}</h3>
                <small>{inspectingChunks.chunks?.length || 0} Parent-Child Chunks</small>
              </div>
              <button className="km-close-btn" onClick={() => setShowChunkModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="chunk-list">
              {inspectingChunks.chunks?.map((c, i) => (
                <div key={c.id || i} className="chunk-item">
                  <div className="chunk-item-header">
                    <span className="chunk-badge">Chunk #{c.chunk_index + 1}</span>
                    <span className="chunk-tokens">{c.metadata?.tokens || 0} tokens</span>
                    {c.metadata?.sectionTitle && (
                      <span className="chunk-section">§ {c.metadata.sectionTitle}</span>
                    )}
                  </div>
                  <pre className="chunk-text">{c.chunk_text}</pre>
                  {c.parent_text && c.parent_text !== c.chunk_text && (
                    <details className="parent-context-toggle">
                      <summary>View Surrounding Parent Context Window</summary>
                      <pre className="parent-text">{c.parent_text}</pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgePage;
