// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: Upload button + file management

import React, { useState } from 'react';
import { Paperclip } from 'lucide-react';
import './FileUpload.css';

// Supports large uploads up to 50MB directly to private Vercel Blob
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_FILE_SIZE_LABEL = '50MB';

const BLOCKED_RISKY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'scr', 'sys', 'drv',
  'msi', 'msp', 'cpl', 'msc', 'hta', 'vbs', 'vbe', 'wsf', 'wsh',
  'jar', 'apk', 'dmg', 'iso', 'img', 'deb', 'rpm', 'app', 'gadget',
  'pif', 'vb', 'reg', 'chm'
]);

const FileUpload = ({ onFileSelect, disabled }) => {
  const [showUploader, setShowUploader] = useState(false);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);

    const risky = files.filter((file) => {
      const ext = file.name.split('.').pop().toLowerCase();
      return BLOCKED_RISKY_EXTENSIONS.has(ext);
    });

    const nonRisky = files.filter((file) => {
      const ext = file.name.split('.').pop().toLowerCase();
      return !BLOCKED_RISKY_EXTENSIONS.has(ext);
    });

    if (risky.length > 0) {
      alert(
        `The following executable/binary files cannot be uploaded for security reasons:\n\n` +
        risky.map((file) => `❌ ${file.name}`).join('\n')
      );
    }

    const oversized = nonRisky.filter((file) => file.size > MAX_FILE_SIZE_BYTES);
    const valid = nonRisky.filter((file) => file.size <= MAX_FILE_SIZE_BYTES);

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
            accept=".pdf,.txt,.log,.rtf,.tex,.doc,.docx,.xlsx,.xls,.csv,.tsv,.jpg,.jpeg,.png,.gif,.webp,.svg,.zip,.tar,.gz,.7z,.js,.mjs,.cjs,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.scala,.r,.lua,.sh,.bash,.zsh,.ps1,.bat,.cmd,.html,.css,.scss,.json,.jsonl,.xml,.yml,.yaml,.toml,.ini,.conf,.sql,.graphql,.proto,.*"
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
