
import React, { useRef, useEffect } from 'react';
import { NotebookEntry, AgentRole, ResearchPhase } from '../types'; 
import { marked, Renderer } from 'marked'; // Import Renderer
import hljs from 'highlight.js';

// Custom renderer for code blocks
const renderer = new Renderer();
renderer.code = (code, lang, escaped) => {
  const highlight = hljs.highlight(code, { language: lang || 'plaintext', ignoreIllegals: true }).value;
  const rawCode = code; // The original, unhighlighted code

  // The preformatted code block
  const preBlock = `<pre><code class="hljs ${lang || ''}">${highlight}</code></pre>`;

  // The copy button
  // Using encodeURIComponent for data attribute to handle special characters
  const copyButton = `<button class="copy-code-btn absolute top-2 right-2 p-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded" data-code="${encodeURIComponent(rawCode)}">Copy</button>`;

  // Container with margin similar to old pre blocks (my-2)
  return `<div class="code-block-wrapper relative my-2">${preBlock}${copyButton}</div>`;
};

// Configure marked to use the custom renderer and highlight.js for syntax highlighting
marked.setOptions({
  renderer: renderer, // Use the custom renderer
  highlight: function(code, lang) {
    // This function is still needed for marked to know that highlighting is handled,
    // even if the main highlighting logic is within renderer.code.
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  },
  pedantic: false,
  gfm: true, // Enable GitHub Flavored Markdown
  breaks: false, // Use GFM line breaks
  sanitize: false // Important: Set to false if you trust the input, or use a sanitizer like DOMPurify. For now, assuming content is trusted.
});

interface NotebookDisplayProps {
  entries: NotebookEntry[];
  currentPhase: string; 
}

const NotebookDisplay: React.FC<NotebookDisplayProps> = ({ entries, currentPhase }) => {
  const endOfNotebookRef = useRef<HTMLDivElement>(null);
  const notebookContainerRef = useRef<HTMLDivElement>(null); // Add a ref for the main container

  useEffect(() => {
    endOfNotebookRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  // Event listener for copy buttons
  useEffect(() => {
    const container = notebookContainerRef.current;
    if (!container) return;

    const handleClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('copy-code-btn')) {
        const codeToCopy = target.dataset.code;
        if (codeToCopy) {
          try {
            await navigator.clipboard.writeText(decodeURIComponent(codeToCopy));
            // Optional: Brief visual feedback
            const originalText = target.innerText;
            target.innerText = 'Copied!';
            setTimeout(() => {
              target.innerText = originalText;
            }, 1500);
          } catch (err) {
            console.error('Failed to copy code:', err);
            // Optional: Visual feedback for error
            const originalText = target.innerText;
            target.innerText = 'Failed!';
            target.style.backgroundColor = 'red';
            setTimeout(() => {
              target.innerText = originalText;
              target.style.backgroundColor = ''; // Reset style
            }, 1500);
          }
        }
      }
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [entries]); // Re-run if entries change, listener is on container

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-inner h-full overflow-y-auto" ref={notebookContainerRef}>
      <div className="flex justify-between items-center mb-3 sticky top-0 bg-gray-800 py-2 z-10">
        <h2 className="text-2xl font-semibold text-indigo-400">Research Notebook</h2>
        <span className="text-sm text-gray-400 bg-gray-700 px-2 py-1 rounded">Phase: {currentPhase}</span>
      </div>
      {(entries || []).length === 0 && (
        <p className="text-gray-400 italic">Notebook is empty. Start by asking a question.</p>
      )}
      {(entries || []).map((entry) => (
        <div key={entry.id} className="mb-4 p-3 bg-gray-750 border border-gray-700 rounded-md shadow">
          <div className="flex justify-between items-center mb-1">
            <span className={`font-semibold ${
              entry.role === AgentRole.CRITIC ? 'text-red-400' 
              : entry.role === AgentRole.USER ? 'text-blue-400' 
              : entry.role === AgentRole.SYSTEM ? 'text-yellow-400' 
              : entry.role === AgentRole.SYNTHESIZER_DECIDER ? 'text-purple-400'
              : 'text-green-400' // Conductor, Loop Conductor, Analyst, Responder
            }`}>
              {entry.role}{entry.loop ? ` (Loop ${entry.loop})` : ''}
              {entry.phase && entry.phase !== currentPhase ? ` [${entry.phase.replace(/^Phase \d+[a-z]?: /,'')}]` : ''}

            </span>
            <span className="text-xs text-gray-500">{entry.timestamp.toLocaleTimeString()}</span>
          </div>
          {/* whitespace-pre-wrap handles newlines in regular text. Code blocks are now handled by marked.parse() */}
          <div className="text-gray-200 whitespace-pre-wrap text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: marked.parse(entry.content) }} />
        </div>
      ))}
      <div ref={endOfNotebookRef} />
    </div>
  );
};

export default NotebookDisplay;
