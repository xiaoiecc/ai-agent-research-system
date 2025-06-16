
import React, { useRef, useEffect } from 'react';
import { NotebookEntry, AgentRole, ResearchPhase } from '../types'; 

interface NotebookDisplayProps {
  entries: NotebookEntry[];
  currentPhase: string; 
}

const NotebookDisplay: React.FC<NotebookDisplayProps> = ({ entries, currentPhase }) => {
  const endOfNotebookRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfNotebookRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);
  
  const formatContent = (content: string) => {
    let html = content;
    
    // Process code blocks first to prevent their content from being altered by other rules
    // Match ```python ... ``` or ``` ... ```
    // The [\s\S]*? part matches any character including newlines, non-greedily
    html = html.replace(/```(?:python\n|\n)?([\s\S]*?)```/g, (match, codeContent) => {
      // Escape HTML characters within the code content
      const escapedCode = codeContent
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
      return `<pre class="bg-gray-900 p-2 my-2 rounded-md overflow-x-auto"><code class="text-sm text-yellow-300">${escapedCode.trim()}</code></pre>`;
    });

    // Headings (applied after code blocks)
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-3 mb-1 text-indigo-400">$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-2 mb-1 text-indigo-300">$1</h3>');
    html = html.replace(/^#### (.*$)/gim, '<h4 class="text-md font-semibold mt-1 text-indigo-200">$1</h4>');
    
    // Bold and Italics (applied after code blocks)
    // Ensure these don't interfere with already processed HTML, though unlikely with current patterns
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); 
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>'); 
    
    // Convert newlines to <br /> for text not inside <pre> tags.
    // This is complex to do perfectly with regex alone.
    // Given the `whitespace-pre-wrap` style on the parent, explicit <br /> might only be needed
    // if newlines are inconsistently handled or if specific line breaks are desired outside of natural paragraph flow.
    // For now, relying on `whitespace-pre-wrap` for general text and `<pre>` for code blocks.
    // If specific <br /> conversion is needed, it should be done carefully to avoid double newlines or breaking <pre> formatting.
    // Example: Split by <pre> blocks, process non-pre sections, then rejoin.
    // For simplicity, we'll assume `whitespace-pre-wrap` is sufficient for most non-code text newlines.
    // html = html.replace(/\n/g, '<br />'); // Avoid global replacement as it breaks <pre>

    return html;
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-inner h-full overflow-y-auto">
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
          {/* whitespace-pre-wrap handles newlines in regular text. Code blocks are handled by <pre> via formatContent */}
          <div className="text-gray-200 whitespace-pre-wrap text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: formatContent(entry.content) }} />
        </div>
      ))}
      <div ref={endOfNotebookRef} />
    </div>
  );
};

export default NotebookDisplay;
