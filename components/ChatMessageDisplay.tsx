
import React from 'react';
import { ChatMessage, AgentRole } from '../types';

interface ChatMessageDisplayProps {
  message: ChatMessage;
}

const ChatMessageDisplay: React.FC<ChatMessageDisplayProps> = ({ message }) => {
  const isUser = message.sender === AgentRole.USER;

  // Basic markdown to HTML conversion for bold and italics
  const formatText = (text: string) => {
    let html = text.replace(/\n/g, '<br />'); // New lines
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>'); // Italics
    // Basic link detection - very simple
    html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">$1</a>');
    return html;
  };


  return (
    <div className={`flex my-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`p-3 rounded-xl max-w-xl lg:max-w-2xl shadow-md ${
          isUser
            ? 'bg-indigo-600 text-white rounded-br-none'
            : 'bg-gray-700 text-gray-100 rounded-bl-none'
        }`}
      >
        <p className="text-sm" dangerouslySetInnerHTML={{ __html: formatText(message.text) }} />
        <p className={`text-xs mt-1 ${isUser ? 'text-indigo-200' : 'text-gray-400'}`}>
          {message.timestamp.toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
};

export default ChatMessageDisplay;
