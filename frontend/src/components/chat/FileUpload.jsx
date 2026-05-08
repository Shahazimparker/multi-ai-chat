// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: Upload button + file management

import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import './FileUpload.css';

const FileUpload = ({ onFileSelect, disabled }) => {
  const [showUploader, setShowUploader] = useState(false);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect?.(file);
    }
    setShowUploader(false);
    e.target.value = ''; // Reset so the same file can be re-selected if removed
  };

  return (
    <div className="file-upload">
      {/* Upload Button */}
      <button
        className="upload-trigger icon-pin"
        onClick={() => setShowUploader(!showUploader)}
        disabled={disabled}
        title="Attach file"
      >
        <Paperclip size={20} />
      </button>

      {/* Upload Input (Hidden) */}
      {showUploader && (
        <div className="upload-input-wrapper">
          <input
            type="file"
            accept=".pdf,.txt,.doc,.docx,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            id="file-input"
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="file-label">
            📁 Click to select a file
          </label>
        </div>
      )}
    </div>
  );
};

export default FileUpload;