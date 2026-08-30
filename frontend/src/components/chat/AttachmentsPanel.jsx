// ============================================================
// FILE: frontend/src/components/chat/AttachmentsPanel.jsx
// PURPOSE: Side panel listing what the user put into the CURRENT chat —
//          attached documents and images pasted into the composer, each
//          viewable and downloadable. Opened from the doc icon at the right
//          of the chat toolbar.
//          The AI's own output is not here; that stays in the sidebar's
//          Artifacts list, so "what I gave it" and "what it made" are two
//          different places instead of one mixed one.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Search, Trash2, X } from 'lucide-react';
import api from '../../config/api';
import { attachmentTypeLabel, isImageAttachment } from './useAttachments';
import './AttachmentsPanel.css';

// Escape before writing into the preview document. That window is same-origin
// with the app, so anything unescaped there runs with the user's session.
// The ampersand goes first — doing it later would double-escape the entities
// introduced by the replacements below.
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

// One in-flight request per file, shared by the thumbnail and the lightbox, so
// opening the large view of an image already on screen costs nothing.
const useBlobCache = () => {
  const urls = useRef(new Map());
  const inFlight = useRef(new Map());

  const fetchBlobUrl = useCallback((fileId) => {
    const cached = urls.current.get(fileId);
    if (cached) return Promise.resolve(cached);
    const pending = inFlight.current.get(fileId);
    if (pending) return pending;

    const request = api.get(`/upload/download/${fileId}`, { responseType: 'blob' })
      .then((res) => {
        const objectUrl = URL.createObjectURL(res.data);
        urls.current.set(fileId, objectUrl);
        return objectUrl;
      })
      .finally(() => { inFlight.current.delete(fileId); });

    inFlight.current.set(fileId, request);
    return request;
  }, []);

  const peek = useCallback((fileId) => urls.current.get(fileId) || null, []);

  // Revoking on unmount rather than per row: a row leaves the list on every
  // keystroke in the search box, and revoking there would refetch each image
  // as soon as the query was cleared again.
  useEffect(() => {
    const map = urls.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  return { fetchBlobUrl, peek };
};

// Images load as they scroll into view. The list can run to 200 files, and
// fetching every blob on open would pull tens of megabytes for rows nobody
// looks at.
const AttachmentThumb = ({ file, fetchBlobUrl, peek }) => {
  const [url, setUrl] = useState(() => peek(file.id));
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (url || failed) return undefined;
    let cancelled = false;

    const load = () => {
      fetchBlobUrl(file.id)
        .then((objectUrl) => { if (!cancelled) setUrl(objectUrl); })
        .catch(() => { if (!cancelled) setFailed(true); });
    };

    // jsdom and older browsers have no observer — there, load straight away
    // rather than showing a placeholder that never resolves.
    if (typeof IntersectionObserver === 'undefined') {
      load();
      return () => { cancelled = true; };
    }

    const element = ref.current;
    if (!element) return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    }, { rootMargin: '200px' });
    observer.observe(element);

    return () => { cancelled = true; observer.disconnect(); };
  }, [file.id, url, failed, fetchBlobUrl]);

  // A span, not a div: this renders inside the row's <button>, whose content
  // model is phrasing content only.
  return (
    <span className="attachment-thumb" ref={ref}>
      {url && !failed
        ? (
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            // A Blob-backed file whose storage fetch failed downloads as its
            // extracted text under an image MIME type: the request succeeds and
            // the decode is what fails. Fall back to the icon rather than
            // leaving a broken-image glyph in the row.
            onError={() => setFailed(true)}
          />
        )
        : <ImageIcon size={18} className={`attachment-thumb-fallback ${failed ? 'failed' : ''}`} />}
    </span>
  );
};

const AttachmentsPanel = ({ open, onClose, attachments, loading, error, onDelete }) => {
  const [query, setQuery] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // The panel stays mounted so it can slide, but its rows are held back until
  // it is first opened: each image row fetches a blob, and a closed panel has
  // no business pulling megabytes of thumbnails.
  const [hasOpened, setHasOpened] = useState(false);
  const { fetchBlobUrl, peek } = useBlobCache();

  useEffect(() => { if (open) setHasOpened(true); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // One Escape closes one layer: the enlarged image first, the panel next.
      if (lightbox) setLightbox(null);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, lightbox]);

  // A lightbox left standing over a closed panel would have nothing behind it.
  useEffect(() => { if (!open) setLightbox(null); }, [open]);

  const handleDownload = useCallback(async (file) => {
    try {
      setBusyId(file.id);
      const res = await api.get(`/upload/download/${file.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const anchor = document.createElement('a');
      anchor.href = url;
      const disposition = res.headers?.['content-disposition'];
      const match = disposition && disposition.match(/filename="?(.+?)"?$/);
      anchor.download = match ? match[1] : file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Attachments] Download failed:', err);
      alert('Failed to download this file.');
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleDelete = useCallback(async (file) => {
    // Says "delete", not "remove from this chat": the file goes from storage
    // entirely, and the AI loses it as context along with it.
    if (!window.confirm(`Delete "${file.name}"? It is removed from storage and the AI can no longer read it. This cannot be undone.`)) return;
    try {
      await onDelete(file.id);
    } catch (err) {
      console.error('[Attachments] Delete failed:', err);
      alert('Failed to delete this file.');
    }
  }, [onDelete]);

  const openDocumentPreview = useCallback(async (file) => {
    try {
      const res = await api.get(`/upload/preview/${file.id}`);
      const data = res.data;
      const previewWindow = window.open('', '_blank');
      if (!previewWindow) return;
      previewWindow.document.write(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8">
        <title>${escapeHtml(data.file_name)}</title>
        <style>
          body { background:#0d1117; color:#c9d1d9; font-family:monospace; padding:24px; margin:0; }
          pre { white-space:pre-wrap; word-wrap:break-word; max-width:100%; }
          h2 { color:#a78bfa; font-family:sans-serif; margin-bottom:12px; }
          .meta { color:#8b949e; font-size:12px; margin-bottom:20px; }
        </style>
        </head><body>
        <h2>${escapeHtml(data.file_name)}</h2>
        <div class="meta">Type: ${escapeHtml(data.file_type || '—')}</div>
        <pre>${escapeHtml(data.content || 'No content available')}</pre>
        </body></html>
      `);
      previewWindow.document.close();
    } catch (err) {
      console.error('[Attachments] Preview failed:', err);
      alert('Preview is not available for this file. Try downloading it instead.');
    }
  }, []);

  const handleOpen = useCallback(async (file) => {
    if (!isImageAttachment(file)) {
      await openDocumentPreview(file);
      return;
    }
    // Show the frame immediately; the <img> fills in when the blob resolves.
    setLightbox({ file, url: peek(file.id) });
    try {
      const url = await fetchBlobUrl(file.id);
      setLightbox((current) => (current?.file.id === file.id ? { ...current, url } : current));
    } catch {
      setLightbox((current) => (current?.file.id === file.id ? { ...current, failed: true } : current));
    }
  }, [fetchBlobUrl, peek, openDocumentPreview]);

  const term = query.trim().toLowerCase();
  const visible = term
    ? attachments.filter((file) => file.name.toLowerCase().includes(term))
    : attachments;

  return (
    <>
      {open && <div className="attachments-overlay" onClick={onClose} />}

      <aside className={`attachments-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
        <header className="attachments-header">
          <div className="attachments-title">
            <FileText size={15} />
            <span>Attachments</span>
            <span className="attachments-count">{attachments.length}</span>
          </div>
          <button type="button" className="attachments-close" onClick={onClose} title="Close" aria-label="Close attachments">
            <X size={16} />
          </button>
        </header>

        <p className="attachments-subtitle">Files and images you added to this chat</p>

        <div className="attachments-search">
          <Search size={13} className="attachments-search-icon" />
          <input
            type="text"
            placeholder="Search attachments…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="attachments-list">
          {loading && attachments.length === 0 && (
            <p className="attachments-empty">Loading…</p>
          )}
          {!loading && error && (
            <p className="attachments-empty error">{error}</p>
          )}
          {!loading && !error && attachments.length === 0 && (
            <p className="attachments-empty">
              Nothing attached to this chat yet. Add a file with the + button, or paste a screenshot
              into the message box — both show up here once the message is sent.
            </p>
          )}
          {!error && attachments.length > 0 && visible.length === 0 && (
            <p className="attachments-empty">No attachment matches “{query.trim()}”.</p>
          )}

          {hasOpened && visible.map((file) => {
            const isImage = isImageAttachment(file);
            return (
              <div key={file.id} className="attachment-item">
                {/* A real button rather than a clickable row, so opening a file
                    is reachable by keyboard. The action buttons stay outside it
                    — a button inside a button is not focusable. */}
                <button
                  type="button"
                  className="attachment-open"
                  onClick={() => handleOpen(file)}
                  title={isImage ? 'View full size' : 'Preview'}
                >
                  {isImage
                    ? <AttachmentThumb file={file} fetchBlobUrl={fetchBlobUrl} peek={peek} />
                    : <span className="attachment-thumb doc"><FileText size={18} /></span>}

                  <span className="attachment-info">
                    <span className="attachment-name">{file.name}</span>
                    <span className="attachment-meta">
                      {attachmentTypeLabel(file)}
                      {file.createdAt ? ` · ${formatDate(file.createdAt)}` : ''}
                    </span>
                  </span>
                </button>

                <div className="attachment-actions">
                  <button
                    type="button"
                    className="attachment-btn"
                    onClick={() => handleDownload(file)}
                    disabled={busyId === file.id}
                    title="Download"
                    aria-label={`Download ${file.name}`}
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    className="attachment-btn danger"
                    onClick={() => handleDelete(file)}
                    title="Delete"
                    aria-label={`Delete ${file.name}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {lightbox && (
        <div className="attachment-lightbox" onClick={() => setLightbox(null)}>
          <button type="button" className="attachment-lightbox-close" onClick={() => setLightbox(null)} aria-label="Close preview">
            <X size={18} />
          </button>
          <figure onClick={(event) => event.stopPropagation()}>
            {lightbox.url
              ? <img src={lightbox.url} alt={lightbox.file.name} />
              : <div className="attachment-lightbox-status">{lightbox.failed ? 'Preview unavailable' : 'Loading…'}</div>}
            <figcaption>{lightbox.file.name}</figcaption>
          </figure>
        </div>
      )}
    </>
  );
};

export default AttachmentsPanel;
