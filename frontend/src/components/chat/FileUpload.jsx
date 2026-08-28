// FILE: frontend/src/components/chat/FileUpload.jsx
// PURPOSE: File-attach validation, shared as a headless hook so the composer's
// "+" menu can drive a single-click OS file picker without duplicating the
// size/extension rules anywhere else.

import { useRef } from 'react';

// Supports large uploads up to 50MB directly to private Vercel Blob
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_FILE_SIZE_LABEL = '50MB';

export const BLOCKED_RISKY_EXTENSIONS = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'scr', 'sys', 'drv',
  'msi', 'msp', 'cpl', 'msc', 'hta', 'vbs', 'vbe', 'wsf', 'wsh',
  'jar', 'apk', 'dmg', 'iso', 'img', 'deb', 'rpm', 'app', 'gadget',
  'pif', 'vb', 'reg', 'chm'
]);

export const FILE_ACCEPT = '.pdf,.txt,.log,.rtf,.tex,.doc,.docx,.xlsx,.xls,.csv,.tsv,.jpg,.jpeg,.png,.gif,.webp,.svg,.zip,.tar,.gz,.7z,.js,.mjs,.cjs,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.scala,.r,.lua,.sh,.bash,.zsh,.ps1,.bat,.cmd,.html,.css,.scss,.json,.jsonl,.xml,.yml,.yaml,.toml,.ini,.conf,.sql,.graphql,.proto,.*';

// Headless: validates the same way FileUpload always has, but leaves the
// hidden <input> and the trigger to the caller. The composer needs the input
// mounted outside the portaled plus-menu panel so the OS picker still opens
// after the panel that triggered it has closed.
export const useFileAttach = ({ onFileSelect }) => {
  const inputRef = useRef(null);

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
    e.target.value = '';
  };

  return {
    inputRef,
    openPicker: () => inputRef.current?.click(),
    inputProps: {
      type: 'file',
      multiple: true,
      accept: FILE_ACCEPT,
      onChange: handleFileSelect,
      style: { display: 'none' },
    },
  };
};
