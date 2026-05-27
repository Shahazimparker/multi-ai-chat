import React from 'react';

const ChatUploadProgress = ({ uploadProgress, uploadMessage, cancelUploadAndStream }) => {
  if (uploadProgress <= 0) return null;

  return (
    <div className="upload-progress-bar">
      <div className="upload-progress-track">
        <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
      </div>
      <span className="upload-progress-label">
        {uploadMessage || `${uploadProgress}%`}
      </span>
      <button className="upload-cancel-btn" onClick={cancelUploadAndStream} title="Cancel upload">
        ✕
      </button>
    </div>
  );
};

export default ChatUploadProgress;
