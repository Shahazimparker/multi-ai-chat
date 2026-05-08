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
    <div className="file-upload">
      {/* Upload Button */}
      <button
        className="upload-trigger"
        onClick={() => setShowUploader(!showUploader)}
        disabled={disabled || uploading}
        title="Upload PDF, Image, or Document"
      >
        <Upload size={16} />
        {uploading ? 'Uploading...' : 'Attach File'}
      </button>

      {/* Upload Input (Hidden) */}
      {showUploader && (
        <div className="upload-input-wrapper">
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.doc,.docx,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            disabled={uploading}
            id="file-input"
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="file-label">
            📁 Click to select files or drag & drop
          </label>
        </div>
      )}

      {/* Uploaded Files List */}
      {files.length > 0 && (
        <div className="files-list">
          <span className="files-count">{files.length} file(s) attached</span>
          {files.map(file => (
            <div key={file.id} className="file-item">
              {getFileIcon(file.type)}
              <div className="file-info">
                <span className="file-name">{file.name}</span>
                <span className="file-chunks">{file.chunks} chunks</span>
              </div>
              <Check size={14} className="check-icon" />
              <button
                className="delete-file"
                onClick={() => handleDelete(file.id)}
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