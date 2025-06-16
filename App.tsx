
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ChatMessage, 
  NotebookEntry, 
  ModelMode, 
  AgentRole, 
  ResearchPhase, 
  LocalGroundingMetadata, 
  GroundingChunk,
  StructuredResearchState,
  SynthesizerDeciderOutput
} from './types';
import { PROMPTS, MAX_RESEARCH_LOOPS, MODEL_MAP } from './constants';
import { callGeminiAPI } from './services/geminiService';
import ChatInput from './components/ChatInput';
import ChatMessageDisplay from './components/ChatMessageDisplay';
import NotebookDisplay from './components/NotebookDisplay';
import ModeSelector from './components/ModeSelector';
import { GroundingMetadata as APIGroundingMetadata, GroundingChunk as ApiLibraryGroundingChunk } from "@google/genai";


// Helper to create unique IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

// Helper to simulate delay for UX
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const initialResearchState = (userQuery: string): StructuredResearchState => ({
  userQuery,
  macroPlan: null,
  currentSynthesizedSolution: null,
  activeLoopTask: null,
  historyLog: [],
  groundingMetadataAccumulated: null,
  loopCount: 0,
  errorMessage: null,
  isConcluded: false,
});


const App: React.FC = () => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [researchState, setResearchState] = useState<StructuredResearchState | null>(null);
  const [currentModelMode, setCurrentModelMode] = useState<ModelMode>(ModelMode.FAST);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentPhase, setCurrentPhase] = useState<ResearchPhase>(ResearchPhase.IDLE);
  
  const researchStateRef = useRef<StructuredResearchState | null>(researchState);
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    researchStateRef.current = researchState;
  }, [researchState]);

  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const addHistoryEntry = useCallback((role: AgentRole, content: string, loop?: number, phase?: ResearchPhase) => {
    setResearchState(prev => {
      if (!prev) return null; // Should not happen if process started
      const newEntry: NotebookEntry = { id: generateId(), role, content, timestamp: new Date(), loop, phase };
      return { ...prev, historyLog: [...prev.historyLog, newEntry] };
    });
  }, []);

  const updateResearchStateFields = useCallback((updates: Partial<StructuredResearchState>) => {
    setResearchState(prev => {
      if (!prev) return null;
      return { ...prev, ...updates };
    });
  }, []);
  
  const parseAndCleanJsonString = (jsonString: string): SynthesizerDeciderOutput | null => {
    let cleanedString = jsonString.trim();
    const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
    const match = cleanedString.match(fenceRegex);
    if (match && match[1]) {
      cleanedString = match[1].trim();
    }

    try {
      return JSON.parse(cleanedString);
    } catch (e) {
      console.error("Failed to parse JSON response:", e, "Original string:", jsonString, "Cleaned string:", cleanedString);
      return null; // Or throw custom error
    }
  };


  const runAgentSystem = useCallback(async (userQuery: string) => {
    setIsProcessing(true);
    const initialRS = initialResearchState(userQuery);
    setResearchState(initialRS);
    setCurrentPhase(ResearchPhase.IDLE); // Will be updated by first agent

    // Utility to execute an LLM call for an agent step
    const executeAgentLLMCall = async (
      agentRole: AgentRole,
      promptContent: string, // The fully formed prompt string
      currentLoop?: number,
      phaseForNotebook?: ResearchPhase,
      useGoogleSearch: boolean = false,
      expectJsonOutput: boolean = false,
      useCodeExecution: boolean = false // New parameter
    ): Promise<string> => {
      const activePhase = phaseForNotebook || currentPhase; // currentPhase is a state variable
      addHistoryEntry(AgentRole.SYSTEM, `Calling ${agentRole}...`, currentLoop, activePhase);
      await delay(100);

      try {
        const { text: resultText, groundingMetadata: apiGroundingMetadata } = await callGeminiAPI(
          promptContent,
          currentModelMode,
          undefined, // systemInstruction, if needed, should be part of promptContent or a new param
          useGoogleSearch,
          expectJsonOutput,
          useCodeExecution // Pass to callGeminiAPI
        );
        addHistoryEntry(agentRole, resultText, currentLoop, activePhase);

        if (apiGroundingMetadata?.groundingChunks && apiGroundingMetadata.groundingChunks.length > 0) {
          setResearchState(prev => {
            if (!prev) return null;
            let updatedGrounding = prev.groundingMetadataAccumulated;
            if (!updatedGrounding) {
              updatedGrounding = { groundingChunks: [] };
            }
            const newChunks: GroundingChunk[] = (apiGroundingMetadata.groundingChunks as ApiLibraryGroundingChunk[])
              .map((apiChunk: ApiLibraryGroundingChunk) => {
                if (apiChunk.web && typeof apiChunk.web.uri === 'string') {
                  return { web: { uri: apiChunk.web.uri, title: apiChunk.web.title || '' } };
                }
                return null;
              })
              .filter(chunk => chunk !== null) as GroundingChunk[]; // Casting to local GroundingChunk[]
            
            updatedGrounding.groundingChunks = [
              ...(updatedGrounding.groundingChunks || []),
              ...newChunks
            ];
            return { ...prev, groundingMetadataAccumulated: updatedGrounding };
          });
        }
        return resultText;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error from LLM";
        addHistoryEntry(AgentRole.SYSTEM, `Error from ${agentRole}: ${errorMessage}`, currentLoop, ResearchPhase.ERROR);
        updateResearchStateFields({ errorMessage });
        // setCurrentPhase(ResearchPhase.ERROR); // Removed: Let runAgentSystem's catch handle phase update
        // setIsProcessing(false); // Removed: Let runAgentSystem's finally block handle this
        throw error;
      }
    };

    try {
      // Phase 1: Conductor
      setCurrentPhase(ResearchPhase.CONDUCTOR);
      const conductorHistoryForContext = researchStateRef.current?.historyLog.map(e => `[${e.timestamp.toLocaleTimeString()}] ${e.role}: ${e.content.substring(0,100)}...`).join('\n') || "";
      const conductorOutput = await executeAgentLLMCall(
        AgentRole.CONDUCTOR,
        PROMPTS.conductor(userQuery, conductorHistoryForContext),
        undefined, ResearchPhase.CONDUCTOR
      );
      // Assuming conductorOutput contains ## Initial Macro Plan and ## Potential Pitfalls
      // For simplicity, we store the whole output as macroPlan. Refinement can parse it.
      updateResearchStateFields({ macroPlan: conductorOutput });
      await delay(500);

      let loopIteration = 0;

      while (loopIteration < MAX_RESEARCH_LOOPS && !(researchStateRef.current?.isConcluded)) {
        loopIteration++;
        updateResearchStateFields({ loopCount: loopIteration });
        const currentRS = researchStateRef.current; // Get latest state for prompts
        if (!currentRS) throw new Error("Research state became null mid-process");

        addHistoryEntry(AgentRole.SYSTEM, `Starting Research Loop ${loopIteration}`, loopIteration, ResearchPhase.PROCESSING);
        
        // Phase 2a: Loop Strategy
        setCurrentPhase(ResearchPhase.LOOP_STRATEGY);
        const loopTaskPrompt = PROMPTS.loopStrategy({
            macroPlan: currentRS.macroPlan, 
            currentSynthesizedSolution: currentRS.currentSynthesizedSolution, 
            activeLoopTask: currentRS.activeLoopTask, // though it's producing this
            historyLog: currentRS.historyLog
        });
        const loopTaskOutput = await executeAgentLLMCall(
            AgentRole.LOOP_CONDUCTOR, loopTaskPrompt, loopIteration, ResearchPhase.LOOP_STRATEGY
        );
        updateResearchStateFields({ activeLoopTask: loopTaskOutput });
        await delay(500);
        if (!researchStateRef.current?.activeLoopTask) throw new Error("Loop task not set");


        // Phase 2b: Adversarial Exploration (Analyst)
        setCurrentPhase(ResearchPhase.ADVERSARIAL_EXPLORATION_ANALYST);
        const analystPrompt = PROMPTS.analyst({
            macroPlan: researchStateRef.current.macroPlan,
            currentSynthesizedSolution: researchStateRef.current.currentSynthesizedSolution,
            activeLoopTask: researchStateRef.current.activeLoopTask,
            historyLog: researchStateRef.current.historyLog
        });
        const analystProposal = await executeAgentLLMCall(
            AgentRole.ANALYST, 
            analystPrompt, 
            loopIteration, 
            ResearchPhase.ADVERSARIAL_EXPLORATION_ANALYST,
            false, // useGoogleSearch
            false, // expectJsonOutput
            true   // useCodeExecution
        );
        await delay(500);

        // Phase 2b: Adversarial Exploration (Critic)
        setCurrentPhase(ResearchPhase.ADVERSARIAL_EXPLORATION_CRITIC);
        const criticPrompt = PROMPTS.critic(analystProposal, {
            macroPlan: researchStateRef.current.macroPlan,
            currentSynthesizedSolution: researchStateRef.current.currentSynthesizedSolution,
            activeLoopTask: researchStateRef.current.activeLoopTask,
        });
        const criticCritique = await executeAgentLLMCall(
            AgentRole.CRITIC, 
            criticPrompt, 
            loopIteration, 
            ResearchPhase.ADVERSARIAL_EXPLORATION_CRITIC,
            false, // useGoogleSearch
            false, // expectJsonOutput
            true   // useCodeExecution
        );
        await delay(500);

        // Phase 2c: Synthesis & Decision
        setCurrentPhase(ResearchPhase.SYNTHESIS_DECISION);
        const synthesizerPrompt = PROMPTS.synthesizerDecider(analystProposal, criticCritique, {
            userQuery: researchStateRef.current.userQuery,
            macroPlan: researchStateRef.current.macroPlan,
            currentSynthesizedSolution: researchStateRef.current.currentSynthesizedSolution,
            activeLoopTask: researchStateRef.current.activeLoopTask,
            historyLog: researchStateRef.current.historyLog,
        });
        const synthesizerRawOutput = await executeAgentLLMCall(
            AgentRole.SYNTHESIZER_DECIDER, synthesizerPrompt, loopIteration, ResearchPhase.SYNTHESIS_DECISION, false, true // Expect JSON
        );
        await delay(500);
        
        const parsedDecision = parseAndCleanJsonString(synthesizerRawOutput) as SynthesizerDeciderOutput | null;

        if (parsedDecision === null) {
            addHistoryEntry(AgentRole.SYSTEM, "Error: Failed to parse Synthesizer & Decider output. Assuming research needs to continue.", loopIteration, ResearchPhase.ERROR);
            updateResearchStateFields({
                currentSynthesizedSolution: (researchStateRef.current?.currentSynthesizedSolution || "") + "\n[System Note: Synthesizer output parsing failed. Last proposal/critique might not be fully integrated.]",
                errorMessage: "Failed to parse Synthesizer & Decider output."
            });
        } else if (!parsedDecision.synthesisUpdate || !parsedDecision.decision || !parsedDecision.reasonForDecision) {
            addHistoryEntry(AgentRole.SYSTEM, "Error: Synthesizer & Decider output lacked required fields. Assuming research needs to continue.", loopIteration, ResearchPhase.ERROR);
            updateResearchStateFields({ 
                currentSynthesizedSolution: (researchStateRef.current?.currentSynthesizedSolution || "") + "\n[System Note: Synthesizer output was missing required fields. Last proposal/critique might not be fully integrated.]",
                errorMessage: "Synthesizer & Decider output incomplete."
            });
        } else {
            updateResearchStateFields({ currentSynthesizedSolution: parsedDecision.synthesisUpdate });
            addHistoryEntry(AgentRole.SYSTEM, `Decision: ${parsedDecision.decision}. Reason: ${parsedDecision.reasonForDecision}`, loopIteration, ResearchPhase.SYNTHESIS_DECISION);

            if (parsedDecision.decision === "YES") {
                updateResearchStateFields({ isConcluded: true });
                addHistoryEntry(AgentRole.SYSTEM, "Conclusion reached by Synthesizer & Decider. Exiting research loop.", loopIteration, ResearchPhase.PROCESSING);
                break;
            } else {
                 addHistoryEntry(AgentRole.SYSTEM, "Further research needed. Continuing loop.", loopIteration, ResearchPhase.PROCESSING);
            }
        }
      } // End of while loop

      if (!(researchStateRef.current?.isConcluded) && loopIteration >= MAX_RESEARCH_LOOPS) {
        addHistoryEntry(AgentRole.SYSTEM, "Max research loops reached. Proceeding to Responder with current information.", undefined, ResearchPhase.PROCESSING);
        updateResearchStateFields({ isConcluded: false }); // Explicitly false if max loops hit
      }

      // Phase 3: Responder
      setCurrentPhase(ResearchPhase.RESPONDER);
      const finalRSForResponder = researchStateRef.current;
      if (!finalRSForResponder) throw new Error("Research state is null before responder phase.");

      let responderOutput = await executeAgentLLMCall(
          AgentRole.RESPONDER,
          PROMPTS.responder(finalRSForResponder),
          undefined, ResearchPhase.RESPONDER, true // Use Google Search for Responder
      );
      
      // Append sources from accumulated grounding metadata
      const accumulatedGrounding = researchStateRef.current?.groundingMetadataAccumulated;
      if (accumulatedGrounding?.groundingChunks && accumulatedGrounding.groundingChunks.length > 0) {
        const uniqueSources = new Map<string, string>();
        accumulatedGrounding.groundingChunks.forEach(chunk => {
          if (chunk.web && chunk.web.uri) {
            uniqueSources.set(chunk.web.uri, chunk.web.title || chunk.web.uri);
          }
        });
        if (uniqueSources.size > 0) {
          let sourcesText = "\n\nSources:\n";
          uniqueSources.forEach((title, uri) => {
            sourcesText += `- [${title}](${uri})\n`; // Assuming ChatMessageDisplay handles markdown links
          });
          responderOutput += sourcesText;
        }
      }
      
      setChatHistory(prev => [...prev, { id: generateId(), sender: AgentRole.RESPONDER, text: responderOutput, timestamp: new Date() }]);
      setCurrentPhase(ResearchPhase.IDLE);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "An unexpected error occurred during the agent process.";
      if (currentPhase !== ResearchPhase.ERROR) { 
        addHistoryEntry(AgentRole.SYSTEM, `CRITICAL ERROR in agent system: ${errorMsg}. Process halted.`, researchStateRef.current?.loopCount, ResearchPhase.ERROR);
        setChatHistory(prev => [...prev, { id: generateId(), sender: AgentRole.RESPONDER, text: `Sorry, a critical error occurred: ${errorMsg}`, timestamp: new Date() }]);
        setCurrentPhase(ResearchPhase.ERROR);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [currentModelMode, addHistoryEntry, updateResearchStateFields, currentPhase]); // currentPhase is a dependency for executeAgentLLMCall

  const handleUserSubmit = (text: string) => {
    setChatHistory(prev => [...prev, { id: generateId(), sender: AgentRole.USER, text, timestamp: new Date() }]);
    runAgentSystem(text);
  };
  
  const handleReset = () => {
    setChatHistory([]);
    setResearchState(null);
    setCurrentPhase(ResearchPhase.IDLE);
    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-gray-900 text-gray-100">
      <header className="p-3 bg-gray-800 border-b border-gray-700 shadow-md flex justify-between items-center">
        <h1 className="text-xl lg:text-2xl font-semibold text-indigo-400">AI Agent Research System</h1>
        <div className="flex items-center space-x-3">
          <ModeSelector currentMode={currentModelMode} onModeChange={setCurrentModelMode} isProcessing={isProcessing} />
          <button
            onClick={handleReset}
            disabled={isProcessing}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow focus:outline-none disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="flex flex-grow overflow-hidden p-2 lg:p-4 space-x-2 lg:space-x-4">
        <div className="w-1/2 flex flex-col bg-gray-850 rounded-lg shadow-xl overflow-hidden">
          <NotebookDisplay 
            entries={researchState?.historyLog || []} 
            currentPhase={currentPhase} 
          />
        </div>

        <div className="w-1/2 flex flex-col bg-gray-850 rounded-lg shadow-xl overflow-hidden">
          <div ref={chatHistoryRef} className="flex-grow p-4 space-y-2 overflow-y-auto">
            {chatHistory.length === 0 && (
              <div className="text-center text-gray-500 pt-10">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <p className="mt-2">Chat history will appear here.</p>
                <p className="text-sm">Ask a question to begin the AI research process.</p>
              </div>
            )}
            {chatHistory.map(msg => (
              <ChatMessageDisplay key={msg.id} message={msg} />
            ))}
             {isProcessing && currentPhase !== ResearchPhase.IDLE && currentPhase !== ResearchPhase.ERROR && (
                <div className="flex justify-start my-3">
                    <div className="p-3 rounded-xl max-w-xl lg:max-w-2xl shadow-md bg-gray-700 text-gray-100 rounded-bl-none">
                        <div className="flex items-center space-x-2">
                            <svg className="animate-spin h-5 w-5 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="text-sm text-gray-300 italic">{currentPhase}...</span>
                        </div>
                    </div>
                </div>
            )}
          </div>
          <ChatInput onSubmit={handleUserSubmit} isProcessing={isProcessing} />
        </div>
      </div>
    </div>
  );
};

export default App;
