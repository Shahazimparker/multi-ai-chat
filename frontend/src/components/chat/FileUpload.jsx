// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: Upload button + file management

import React, { useState } from 'react';
import { Upload, X, File, FileText, Image, Check } from 'lucide-react';
import api from '../../config/api';
import './FileUpload.css';

const FileUpload = ({ topicId, onFileUploaded, disabled }) => {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showUploader, setShowUploader] = useState(false);

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    setUploading(true);

    for (const file of selectedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        if (topicId) formData.append('topicId', topicId);

        const res = await api.post('/upload/file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        setFiles(prev => [...prev, {
          id: res.data.fileId,
          name: res.data.fileName,
          type: res.data.fileType,
          chunks: res.data.chunkCount,
          status: 'uploaded',
        }]);

        onFileUploaded?.({
          fileName: res.data.fileName,
          chunks: res.data.chunkCount,
        });
      } catch (err) {
        alert(`Upload failed: ${err.message}`);
      }
    }

    setUploading(false);
    setShowUploader(false);
  };

  const handleDelete = async (fileId) => {
    try {
      await api.delete(`/upload/${fileId}`);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const getFileIcon = (type) => {
    if (type === 'image') return <Image size={14} />;
    if (type === 'pdf') return <File size={14} />;
    return <FileText size={14} />;
  };

    return (
    <div className="file-upload-compact">
      {/* 1. Small Icon Trigger - This sits inside your input-box next to the text */}
      <label 
        htmlFor="file-input" 
        className={`upload-icon-trigger ${uploading ? 'uploading' : ''} ${disabled ? 'disabled' : ''}`}
        title="Attach PDF, Image, or Document"
      >
        {uploading ? (
          <Loader2 size={20} className="animate-spin" />
        ) : (
          <Upload size={20} />
        )}
        <input
          type="file"
          id="file-input"
          multiple
          accept=".pdf,.txt,.doc,.docx,.jpg,.jpeg,.png"
          onChange={handleFileSelect}
          disabled={disabled || uploading}
          style={{ display: 'none' }}
        />
      </label>

      {/* 2. Floating File List - Sits ABOVE the input bar */}
      {files.length > 0 && (
        <div className="floating-files-preview">
          {files.map(file => (
            <div key={file.id} className="mini-file-chip">
              {getFileIcon(file.type)}
              <span className="mini-file-name" title={file.name}>{file.name}</span>
              <button
                className="mini-delete-btn"
                onClick={() => handleDelete(file.id)}
                type="button"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileUpload;