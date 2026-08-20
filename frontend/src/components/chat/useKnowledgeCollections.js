// ============================================================
// FILE: frontend/src/components/chat/useKnowledgeCollections.js
// PURPOSE: Shared collection list for the two places that attach knowledge
//          bases to a message — the toolbar selector and the composer + menu.
//          Both render the same list, so both read it from here.
// ============================================================

import { useEffect, useState } from 'react';
import api from '../../config/api';

export const useKnowledgeCollections = () => {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchCollections = async () => {
      try {
        setLoading(true);
        const res = await api.get('/knowledge/collections');
        if (isMounted) {
          setCollections(res.data?.collections || []);
        }
      } catch (err) {
        console.warn('[useKnowledgeCollections] Fetch collections error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchCollections();
    return () => { isMounted = false; };
  }, []);

  return { collections, loading };
};

// Toggling one id in the selection — identical in both selectors.
export const toggleCollectionId = (selectedIds, colId) => (
  selectedIds.includes(colId)
    ? selectedIds.filter((id) => id !== colId)
    : [...selectedIds, colId]
);

export default useKnowledgeCollections;
