import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '../components/chat/Sidebar';
import MobileNav from '../components/chat/MobileNav';
import ModelSelector from '../components/chat/ModelSelector';
import TokenBar from '../components/layout/TokenBar';
import { useAuth } from '../context/AuthContext';
import './ChatPage.css';
import UnifiedModelModal from '../components/chat/UnifiedModelModal';
import ChatMessagesPanel from '../components/chat/ChatMessagesPanel';
import ChatInputPanel from '../components/chat/ChatInputPanel';
import { useChatSession } from './hooks/useChatSession';
import { useChatComposer } from './hooks/useChatComposer';

const ChatPage = () => {
  const { refreshTokenStats } = useAuth();
  const session = useChatSession({ refreshTokenStats });
  const composer = useChatComposer();
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showAdvancedMemory, setShowAdvancedMemory] = useState(false);
  const bottomRef = useRef(null);
  const messagesAreaRef = useRef(null);
  const isUserAtBottom = useRef(true);

  const isStreaming = session.messages.length > 0 && session.messages[session.messages.length - 1]?.streaming;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    isUserAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollBtn(!isUserAtBottom.current);
  }, []);

  useEffect(() => {
    if (isUserAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [isStreaming, session.loading, session.messages]);

  const handleSend = useCallback(async () => {
    const payload = composer.consumeDraft();
    await session.requestSend(payload);
  }, [composer, session]);

  const handleApprovalComplete = useCallback((approvalId, result) => {
    console.log(`[Approval] ${approvalId} completed: ${result}`);
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-root">
      <Sidebar
        activeTopic={session.activeTopic}
        onTopicSelect={session.handleTopicSelect}
        onNewChat={session.handleNewChat}
        refreshTrigger={session.sidebarRefresh}
      />

      <main className="chat-main">
        <div className="chat-toolbar">
          <MobileNav
            activeTopic={session.activeTopic}
            onTopicSelect={session.handleTopicSelect}
            onNewChat={session.handleNewChat}
            refreshTrigger={session.sidebarRefresh}
          />

          <ModelSelector
            selectedModel={session.model}
            onModelChange={(nextModel) => {
              session.setModel(nextModel);
              session.setProviderModelId(null);
            }}
            onUnifiedProviderSelect={session.setUnifiedProvider}
          />

          {session.activeTopic && (
            <span className="topic-hint">
              Continuing topic · {session.messages.length} messages
            </span>
          )}
        </div>

        <TokenBar />

        {session.loading && (
          <div className="ai-loading-overlay">
            <div className="floating-orbs">
              <div className="float-orb" />
              <div className="float-orb" />
              <div className="float-orb" />
            </div>
          </div>
        )}

        <ChatMessagesPanel
          messages={session.messages}
          loading={session.loading}
          isStreaming={isStreaming}
          uploadProgress={session.uploadProgress}
          uploadMessage={session.uploadMessage}
          cancelUploadAndStream={session.cancelUploadAndStream}
          showScrollBtn={showScrollBtn}
          scrollToBottom={scrollToBottom}
          bottomRef={bottomRef}
          messagesAreaRef={messagesAreaRef}
          handleScroll={handleScroll}
          setSuggestionInput={composer.setInput}
          onApprovalComplete={handleApprovalComplete}
        />

        <ChatInputPanel
          session={session}
          composer={composer}
          showAdvancedMemory={showAdvancedMemory}
          setShowAdvancedMemory={setShowAdvancedMemory}
          handleSend={handleSend}
          handleKeyDown={handleKeyDown}
        />
      </main>

      {session.llmError && (
        <div className="llm-error-backdrop">
          <div className="llm-error-modal">
            <h3>Selected LLM unavailable</h3>
            <p>{session.llmError.error}</p>
            {Array.isArray(session.llmError.suggestedModels) && session.llmError.suggestedModels.length > 0 && (
              <div className="llm-suggested-models">
                {session.llmError.suggestedModels.map((id) => {
                  const m = session.models.find((entry) => entry.id === id);
                  if (!m) return null;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        session.setModel(m);
                        session.setProviderModelId(null);
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="llm-error-note">Choose another model from the dropdown, then continue.</p>
            <div className="llm-error-actions">
              <button onClick={() => session.setLlmError(null)}>Cancel</button>
              <button onClick={session.handleContinueWithCurrentModel}>Continue with current model</button>
              <button
                onClick={() => {
                  if (session.failedMessage) composer.setInput(session.failedMessage.text);
                  session.setLlmError(null);
                }}
              >
                Continue with new LLM
              </button>
            </div>
          </div>
        </div>
      )}

      {session.unifiedProvider && (
        <UnifiedModelModal
          provider={session.unifiedProvider}
          onClose={() => session.setUnifiedProvider(null)}
          onSelect={(providerModel) => {
            session.setModel({
              ...session.unifiedProvider,
              label: `${session.unifiedProvider.label}: ${providerModel.label}`,
              paid: providerModel.paid,
            });
            session.setProviderModelId(providerModel.id);
            session.setUnifiedProvider(null);
          }}
        />
      )}
    </div>
  );
};

export default ChatPage;
