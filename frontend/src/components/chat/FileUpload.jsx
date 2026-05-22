// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: Upload button + file management

import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import './FileUpload.css';

const FileUpload = ({ onFileSelect, disabled }) => {
  const [showUploader, setShowUploader] = useState(false);

  const handleFileSelect = (e) => {
    const files = e.target.files;
    if (files?.length > 0) {
      onFileSelect?.(Array.from(files));
    }
    setShowUploader(false);
    e.target.value = '';
  };

  return (
    <div className="file-upload">
      <button
        className="upload-trigger icon-pin"
        onClick={() => setShowUploader(!showUploader)}
        disabled={disabled}
        title="Attach files"
      >
        <Paperclip size={20} />
      </button>

      {showUploader && (
        <div className="upload-input-wrapper">
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.doc,.docx,.jpg,.jpeg,.png,.zip,.js,.ts,.py,.java,.cpp,.go,.rb,.cjs,.mjs,.html,.json,.css,.xml,.yml,.yaml,.md,.sql,.sh,.bat,.php,.rs,.swift,.kt,.vue,.svelte,.*"
            onChange={handleFileSelect}
            id="file-input"
            style={{ display: 'none' }}
          />
          <label htmlFor="file-input" className="file-label">
            📁 Click to select files (multi-select supported)
          </label>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
