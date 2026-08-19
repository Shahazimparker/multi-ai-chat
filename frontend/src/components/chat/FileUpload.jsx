// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: Upload button + file management

import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import './FileUpload.css';

// Must stay in sync with backend/routes/upload.routes.js MAX_UPLOAD_BYTES —
// Vercel Serverless Functions hard-cap the request body at ~4.5MB, so this
// is a hard platform ceiling, not a tunable app setting.
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_FILE_SIZE_LABEL = '4MB';

const FileUpload = ({ onFileSelect, disabled }) => {
  const [showUploader, setShowUploader] = useState(false);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const oversized = files.filter((file) => file.size > MAX_FILE_SIZE_BYTES);
    const valid = files.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);

    if (oversized.length > 0) {
      alert(
        `${oversized.length > 1 ? 'These files exceed' : `"${oversized[0].name}" exceeds`} the ${MAX_FILE_SIZE_LABEL} upload limit and will not be attached:\n\n` +
        oversized.map((file) => `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB)`).join('\n')
      );
    }

    if (valid.length > 0) {
      onFileSelect?.(valid);
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
            📁 Click to select files (multi-select supported, max {MAX_FILE_SIZE_LABEL} each)
          </label>
        </div>
      )}
    </div>
  );
};

export default FileUpload;
