
export enum ModelMode {
  FAST = 'Fast',
  SLOW = 'Slow',
}

export enum AgentRole {
  // Main Roles for direct LLM calls that produce primary notebook content
  CONDUCTOR = 'Conductor (C)',
  LOOP_CONDUCTOR = 'Loop Conductor (C)',
  ANALYST = 'Analyst (C)',
  CRITIC = 'Critic (M)',
  SYNTHESIZER_DECIDER = 'Synthesizer & Decider (C)', // New role
  RESPONDER = 'Responder (C)',
  // System/User roles for chat and notebook structure
  USER = 'User',
  SYSTEM = 'System', // For system messages, e.g. loop start/end, errors
}

export enum ResearchPhase {
  IDLE = 'Idle',
  CONDUCTOR = 'Phase 1: Conductor',
  LOOP_STRATEGY = 'Phase 2a: Loop Strategy',
  ADVERSARIAL_EXPLORATION_ANALYST = 'Phase 2b: Adversarial Exploration (Analyst)',
  ADVERSARIAL_EXPLORATION_CRITIC = 'Phase 2b: Adversarial Exploration (Critic)',
  SYNTHESIS_DECISION = 'Phase 2c: Synthesis & Decision', // New phase
  RESPONDER = 'Phase 3: Responder',
  PROCESSING = 'Processing...',
  ERROR = 'Error',
}

export interface ChatMessage {
  id: string;
  sender: AgentRole.USER | AgentRole.RESPONDER;
  text: string;
  timestamp: Date;
}

export interface NotebookEntry {
  id: string;
  role: AgentRole;
  content: string;
  timestamp: Date;
  loop?: number;
  phase?: ResearchPhase;
}

export interface AgentOutput { // This type seems unused currently, but kept for potential future use.
  role: AgentRole;
  output: string;
  timestamp: Date;
}

export interface GroundingChunkWeb {
  uri: string;
  title: string;
}

export interface GroundingChunk {
  web?: GroundingChunkWeb;
  // Other types of chunks can be added here if needed
}

export interface LocalGroundingMetadata { // Renamed to avoid confusion with API's GroundingMetadata
  groundingChunks?: GroundingChunk[];
  // Other grounding metadata fields can be added
}

export interface StructuredResearchState {
  userQuery: string;
  macroPlan: string | null;
  currentSynthesizedSolution: string | null;
  activeLoopTask: string | null;
  historyLog: NotebookEntry[];
  groundingMetadataAccumulated: LocalGroundingMetadata | null;
  loopCount: number;
  errorMessage: string | null;
  isConcluded: boolean;
}

export interface SynthesizerDeciderOutput {
  synthesisUpdate: string;
  decision: "YES" | "NO";
  reasonForDecision: string;
}
