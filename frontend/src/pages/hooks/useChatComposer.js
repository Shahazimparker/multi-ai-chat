import { useCallback, useRef, useState } from 'react';

const visionProviders = ['openai', 'gemini', 'claude', 'deepseek'];
const visionOpenRouterModels = ['gemini', 'gpt', 'claude', 'deepseek'];

const compressImageForChat = (dataUrl, maxDimension = 1600, quality = 0.85) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDimension && height <= maxDimension && dataUrl.length < 2 * 1024 * 1024) {
        return resolve(dataUrl);
      }
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

export const useChatComposer = () => {
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingImage, setPendingImage] = useState(null);
  const [webEnabled, setWebEnabled] = useState(false);
  const textareaRef = useRef(null);

  const handlePaste = useCallback((event, model) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const provider = model?.provider;
      const modelId = model?.model || '';
      const supportsVision =
        Boolean(model?.supportsVision) ||
        visionProviders.includes(provider) ||
        (provider === 'openrouter' && visionOpenRouterModels.some((value) => modelId.includes(value)));

      if (!supportsVision) {
        alert('This model does not support image input. Use the attachment button or switch to a vision-capable model.');
        return;
      }

      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const optimized = await compressImageForChat(reader.result);
          setPendingImage(optimized);
        } catch {
          setPendingImage(reader.result);
        }
      };
      reader.readAsDataURL(file);
      return;
    }
  }, []);

  const consumeDraft = useCallback(() => {
    const payload = { text: input, files: [...pendingFiles], image: pendingImage, forceWebSearch: webEnabled };
    setInput('');
    setPendingFiles([]);
    setPendingImage(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    return payload;
  }, [input, pendingFiles, pendingImage, webEnabled]);

  const removePendingFile = useCallback((index) => {
    setPendingFiles((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  return {
    input,
    setInput,
    pendingFiles,
    setPendingFiles,
    pendingImage,
    setPendingImage,
    webEnabled,
    setWebEnabled,
    textareaRef,
    handlePaste,
    consumeDraft,
    removePendingFile,
  };
};
