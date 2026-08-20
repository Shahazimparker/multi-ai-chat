import React, { useCallback, useEffect, useRef, useState } from 'react';
import Sidebar from '../components/chat/Sidebar';
import MobileNav from '../components/chat/MobileNav';
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

  // Stable identity matters: ModelSelector lists this in the dep array of the
  // effect that fetches /chat/models, so an inline arrow here would refetch the
  // model list on every ChatPage render (including every streamed token).
  const handleModelChange = useCallback((nextModel) => {
    session.setModel(nextModel);
    session.setProviderModelId(null);
  }, [session.setModel, session.setProviderModelId]);

  // Choosing an effort level from the model list picks the model too, so both
  // writes must be addressed to that model by id: session.setReasoningEffort
  // targets whichever model is selected *now*, which is still the old one until
  // React commits setModel. Naming a level is also asking to think, so thinking
  // comes on for models that let it be switched off.
  const handleLevelSelect = useCallback((nextModel, level) => {
    handleModelChange(nextModel);
    session.setReasoningEffortFor(nextModel.id, level);
    if (nextModel.reasoning?.canDisable !== false) {
      session.setThinkingEnabledFor(nextModel.id, true);
    }
  }, [handleModelChange, session.setReasoningEffortFor, session.setThinkingEnabledFor]);

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

  const handleClarificationSubmit = useCallback(async (text) => {
    await session.requestSend({ text, files: [], image: null, forceWebSearch: false });
  }, [session]);

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
        <TokenBar>
          <MobileNav
            activeTopic={session.activeTopic}
            onTopicSelect={session.handleTopicSelect}
            onNewChat={session.handleNewChat}
            refreshTrigger={session.sidebarRefresh}
          />
        </TokenBar>

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
          onClarificationSubmit={handleClarificationSubmit}
        />

        <ChatInputPanel
          session={session}
          composer={composer}
          showAdvancedMemory={showAdvancedMemory}
          setShowAdvancedMemory={setShowAdvancedMemory}
          handleSend={handleSend}
          handleKeyDown={handleKeyDown}
          handleModelChange={handleModelChange}
          handleLevelSelect={handleLevelSelect}
        />
      </main>

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
