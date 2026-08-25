import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';

describe('MessageBubble timestamp rendering', () => {
  it('renders timestamp for user message when created_at is provided', () => {
    const testDate = new Date().toISOString();
    const message = {
      role: 'user',
      content: 'Hello, this is a test message',
      created_at: testDate,
    };

    const { container } = render(<MessageBubble message={message} />);

    // Bubble class should have role
    const bubbleEl = container.querySelector('.msg-bubble.user');
    expect(bubbleEl).toBeInTheDocument();

    // Timestamp element should exist
    const timestampEl = container.querySelector('.msg-timestamp');
    expect(timestampEl).toBeInTheDocument();

    const timeEl = container.querySelector('time');
    expect(timeEl).toBeInTheDocument();
    expect(timeEl.textContent).toContain('Today');

    // Right-aligned wrapper should contain timestamp
    const footerRight = container.querySelector('.bubble-footer-right');
    expect(footerRight).toContainElement(timestampEl);
  });

  it('renders timestamp for assistant message along with copy button', () => {
    const testDate = new Date().toISOString();
    const message = {
      role: 'assistant',
      content: 'Here is the assistant response.',
      created_at: testDate,
    };

    const { container } = render(<MessageBubble message={message} />);

    // Bubble class should have role
    const bubbleEl = container.querySelector('.msg-bubble.assistant');
    expect(bubbleEl).toBeInTheDocument();

    // Copy button on the left
    const copyBtn = container.querySelector('.copy-btn');
    expect(copyBtn).toBeInTheDocument();

    // Timestamp on the right
    const timestampEl = container.querySelector('.msg-timestamp');
    expect(timestampEl).toBeInTheDocument();
    expect(timestampEl.getAttribute('title')).toBeTruthy();

    const footerRight = container.querySelector('.bubble-footer-right');
    expect(footerRight).toContainElement(timestampEl);
  });

  it('handles message when timestamp is missing gracefully', () => {
    const message = {
      role: 'user',
      content: 'Message without timestamp',
    };

    const { container } = render(<MessageBubble message={message} />);

    const timestampEl = container.querySelector('.msg-timestamp');
    expect(timestampEl).toBeNull();
  });
});
