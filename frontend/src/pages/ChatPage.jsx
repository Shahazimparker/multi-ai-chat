import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import Sidebar from '../components/chat/Sidebar';
import MobileNav from '../components/chat/MobileNav';
import TokenBar from '../components/layout/TokenBar';
import { useAuth } from '../context/AuthContext';
import './ChatPage.css';
import UnifiedModelModal from '../components/chat/UnifiedModelModal';
import ChatMessagesPanel from '../components/chat/ChatMessagesPanel';
import ChatInputPanel from '../components/chat/ChatInputPanel';
import AttachmentsPanel from '../components/chat/AttachmentsPanel';
import ChatSearchPanel from '../components/chat/ChatSearchPanel';
import useAttachments from '../components/chat/useAttachments';
import { useChatSession } from './hooks/useChatSession';
import { useChatComposer } from './hooks/useChatComposer';

const ChatPage = () => {
  const { refreshTokenStats } = useAuth();
  const session = useChatSession({ refreshTokenStats });
  const composer = useChatComposer();
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showAdvancedMemory, setShowAdvancedMemory] = useState(false);
  // One right rail, so one piece of state rather than a boolean per panel —
  // two booleans would let both drawers stack on the same 360px of screen.
  const [rightPanel, setRightPanel] = useState(null); // null | 'attachments' | 'search'
  const attachmentsOpen = rightPanel === 'attachments';
  const searchOpen = rightPanel === 'search';
  // Owned here, not inside the panel: the toolbar button shows the count while
  // the panel is closed. `sidebarRefresh` ticks whenever a file is uploaded or
  // a pasted image is archived mid-send, so the list is current the first time
  // it is opened.
  const {
    attachments,
    loading: attachmentsLoading,
    error: attachmentsError,
    reload: reloadAttachments,
    remove: removeAttachment,
  } = useAttachments(session.activeTopic?.id, session.sidebarRefresh);
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

  // Web search is scoped to the conversation it was switched on in. Leaving it
  // armed while moving to another chat silently searches the web there too, so
  // both ways of changing conversation disarm it.
  const handleTopicSelect = useCallback(async (topic) => {
    composer.setWebEnabled(false);
    await session.handleTopicSelect(topic);
  }, [composer, session]);

  const handleNewChat = useCallback(() => {
    composer.setWebEnabled(false);
    session.handleNewChat();
  }, [composer, session]);

  // Opening refetches. A file uploaded through the composer reaches the list
  // via `sidebarRefresh`, but an upload or delete in another tab would
  // otherwise leave this one stale until the next send. The open state is read
  // rather than flipped inside the updater — React may run an updater twice,
  // and a fetch is not something to run twice.
  const handleAttachmentsToggle = useCallback(() => {
    if (!attachmentsOpen) reloadAttachments();
    setRightPanel(attachmentsOpen ? null : 'attachments');
  }, [attachmentsOpen, reloadAttachments]);

  const closeRightPanel = useCallback(() => setRightPanel(null), []);

  const handleSearchToggle = useCallback(() => {
    setRightPanel(searchOpen ? null : 'search');
  }, [searchOpen]);

  // Ctrl+F / Cmd+F opens find-in-chat, the way Teams and Slack do. Taking the
  // browser's find over is the point: the transcript is one virtualised column
  // of markdown, and the native bar can only match what is currently painted,
  // while this searches every loaded turn and can scroll to the one it found.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'f' && event.key !== 'F') return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setRightPanel('search');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        onTopicSelect={handleTopicSelect}
        onNewChat={handleNewChat}
        refreshTrigger={session.sidebarRefresh}
      />

      <main className="chat-main">
        <TokenBar
          trailing={
            <>
              <button
                type="button"
                className={`chat-search-toggle ${searchOpen ? 'active' : ''}`}
                onClick={handleSearchToggle}
                title="Find in this chat (Ctrl+F)"
                aria-expanded={searchOpen}
                aria-label="Find in this chat"
              >
                <Search size={14} />
              </button>

              <button
                type="button"
                className={`attachments-toggle ${attachmentsOpen ? 'active' : ''}`}
                onClick={handleAttachmentsToggle}
                title="Files and images you added to this chat"
                aria-expanded={attachmentsOpen}
              >
                <FileText size={14} />
                <span className="attachments-toggle-label">Attachments</span>
                {attachments.length > 0 && (
                  <span className="attachments-toggle-count">{attachments.length}</span>
                )}
              </button>
            </>
          }
        >
          <MobileNav
            activeTopic={session.activeTopic}
            onTopicSelect={handleTopicSelect}
            onNewChat={handleNewChat}
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

      {/* Keyed by chat: switching conversations remounts the panel, which
          revokes the object URLs it built for the previous chat's thumbnails
          instead of holding every image of every chat visited this session. */}
      <AttachmentsPanel
        key={session.activeTopic?.id || 'new-chat'}
        open={attachmentsOpen}
        onClose={closeRightPanel}
        attachments={attachments}
        loading={attachmentsLoading}
        error={attachmentsError}
        onDelete={removeAttachment}
      />

      <ChatSearchPanel
        open={searchOpen}
        onClose={closeRightPanel}
        messages={session.messages}
      />

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
