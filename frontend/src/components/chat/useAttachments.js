// ============================================================
// FILE: frontend/src/components/chat/useAttachments.js
// PURPOSE: What the user put into THIS conversation — documents attached to
//          a message and images pasted into the composer. Two things it is
//          deliberately not:
//            · the AI's output (that is the sidebar's Artifacts list; the two
//              are separated server-side by uploaded_files_rag.source), and
//            · other chats' uploads (scoped by topic, unlike Artifacts).
//          Lives here rather than inside AttachmentsPanel because the
//          toolbar button shows the count while the panel is closed.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import api from '../../config/api';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'tiff', 'tif', 'ico']);

// `file_type` is not one thing: an uploaded picture is categorised as 'image'
// (SUPPORTED_FILE_TYPES), a pasted or generated one carries its extension, and
// older rows may hold a MIME type. The filename is the reliable fallback, so
// every form gets a look rather than the first non-empty one winning.
export const isImageAttachment = (attachment) => {
  const type = String(attachment?.type || '').toLowerCase();
  if (type === 'image' || type.startsWith('image/') || IMAGE_EXTENSIONS.has(type)) return true;
  const nameExt = String(attachment?.name || '').split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(nameExt);
};

// Turns whichever of those forms a row carries into a short badge: 'image/png'
// and 'image' both read as PNG when the filename says so.
export const attachmentTypeLabel = (attachment) => {
  const nameExt = String(attachment?.name || '').split('.').pop().toLowerCase();
  if (nameExt && nameExt !== String(attachment?.name || '').toLowerCase()) return nameExt.toUpperCase();
  const type = String(attachment?.type || '').toLowerCase();
  if (type.includes('/')) return type.split('/').pop().toUpperCase();
  return (type || 'file').toUpperCase();
};

export const useAttachments = (topicId, refreshTrigger) => {
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    // A chat that does not exist yet owns nothing. Anything attached before the
    // first send is linked to the topic the server creates for it, and lands
    // here on the refresh that follows.
    if (!topicId) {
      setAttachments([]);
      setError('');
      return;
    }
    try {
      setLoading(true);
      const res = await api.get('/upload/files', { params: { source: 'upload', topicId } });
      setAttachments((res.data?.files || []).map((file) => ({
        id: file.file_id,
        name: file.file_name,
        type: file.file_type || '',
        createdAt: file.created_at,
      })));
      setError('');
    } catch (err) {
      console.warn('[useAttachments] Fetch failed:', err?.message);
      setError('Could not load attachments');
    } finally {
      setLoading(false);
    }
  }, [topicId]);

  useEffect(() => { reload(); }, [reload, refreshTrigger]);

  // Drop the row locally too: the panel is usually open when this runs, and
  // waiting for a refetch to make the deleted file disappear reads as a no-op.
  const remove = useCallback(async (id) => {
    await api.delete(`/upload/${id}`);
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return { attachments, loading, error, reload, remove };
};

export default useAttachments;
