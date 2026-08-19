import { useCallback, useRef, useState } from 'react';

const visionProviders = ['openai', 'gemini', 'claude'];
const visionOpenRouterModels = ['gemini', 'gpt', 'claude'];

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
        visionProviders.includes(provider) ||
        (provider === 'openrouter' && visionOpenRouterModels.some((value) => modelId.includes(value)));

      if (!supportsVision) {
        alert('This model does not support image input. Use the attachment button or switch to a vision-capable model.');
        return;
      }

      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setPendingImage(reader.result);
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
