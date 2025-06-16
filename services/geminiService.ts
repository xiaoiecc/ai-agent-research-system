
import { GoogleGenAI, GenerateContentResponse, Content, GenerateContentParameters, GroundingMetadata, Part } from "@google/genai";
import { MODEL_MAP } from '../constants'; 
import { ModelMode } from '../types';

// Ensure GEMINI_API_KEY is available in the window object.
if (!(window as any).GEMINI_API_KEY) {
  console.warn("GEMINI_API_KEY is not set in window. Please set it in index.html. Gemini API calls will likely fail.");
}

const ai = new GoogleGenAI({ apiKey: (window as any).GEMINI_API_KEY });

function parseGeneratedContentResponse(response: GenerateContentResponse): { text: string; groundingMetadata?: GroundingMetadata } {
  let combinedText = "";
  const parts = response.candidates?.[0]?.content?.parts;

  if (parts && Array.isArray(parts)) {
    parts.forEach(part => {
      if (part.text) {
        combinedText += part.text + "\n";
      }
      // Ensure executableCode and its code property exist
      if (part.executableCode && typeof part.executableCode.code === 'string') {
        combinedText += "\n--- 代码段 ---\n```python\n" + part.executableCode.code + "\n```\n";
      }
      // Ensure codeExecutionResult and its output property exist
      if (part.codeExecutionResult && typeof part.codeExecutionResult.output === 'string') {
        combinedText += "\n--- 代码执行结果 ---\n```\n" + part.codeExecutionResult.output + "\n```\n";
      }
    });
  } else if (response.text) { 
    // Fallback if parts structure isn't as expected, or for simple text responses
    // or if the model only returns a single text part in response.text directly
    combinedText = response.text;
  }
  
  // If after processing parts, combinedText is still empty but response.text has content, use response.text.
  // This handles cases where the response might have a simple text structure not in `parts`.
  if (!combinedText && response.text) {
    combinedText = response.text;
  }

  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  return { text: combinedText.trim(), groundingMetadata };
}

const MAX_RETRIES = 6;
const INITIAL_RETRY_DELAY_MS = 600;

// Helper function for async delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to check if an error message indicates a 404 Not Found error
function isNotFoundError(error: any): boolean {
  if (error && error.message && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    return message.includes('404');
  }
  return false;
}

export async function callGeminiAPI(
  prompt: string,
  modelMode: ModelMode,
  systemInstruction?: string,
  useGoogleSearch?: boolean,
  expectJsonOutput?: boolean,
  useCodeExecution?: boolean
): Promise<{ text: string; groundingMetadata?: GroundingMetadata }> {
  const modelName = MODEL_MAP[modelMode];

  if (!(window as any).GEMINI_API_KEY) {
     console.error("GEMINI_API_KEY is not configured in window. Cannot call Gemini API.");
     throw new Error("GEMINI_API_KEY is not configured in window. Cannot call Gemini API.");
  }
  
  const modelRequestConfig: any = {}; 

  if (systemInstruction) {
    modelRequestConfig.systemInstruction = systemInstruction;
  }
  
  const tools: any[] = [];
  if (useGoogleSearch) {
    tools.push({googleSearch: {}});
    // As per guidelines, when using googleSearch tool, responseMimeType for JSON should not be set.
    // The model might not respect it anyway.
    if (expectJsonOutput) {
      console.warn("Google Search and JSON output requested simultaneously. `responseMimeType` will not be set to 'application/json' when the Google Search tool is active, as per Gemini API guidelines. The model will handle JSON output based on the prompt if capable.");
    }
  } else if (useCodeExecution) {
    tools.push({codeExecution: {}});
    if (expectJsonOutput) {
      modelRequestConfig.responseMimeType = "application/json";
    }
  } else if (expectJsonOutput) { // Only set responseMimeType if no specific tool (like search) overrides it
    modelRequestConfig.responseMimeType = "application/json";
  }

  if (tools.length > 0) {
    modelRequestConfig.tools = tools;
  }
  
  const generateContentRequest: GenerateContentParameters = {
    model: modelName,
    contents: prompt,
  };

  if (Object.keys(modelRequestConfig).length > 0) {
    generateContentRequest.config = modelRequestConfig;
  }
  
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`Retrying Gemini API call (attempt ${attempt} of ${MAX_RETRIES})...`);
      }
      const response: GenerateContentResponse = await ai.models.generateContent(generateContentRequest);
      return parseGeneratedContentResponse(response);
    } catch (error) {
      console.error(`Gemini API call failed (attempt ${attempt}):`, error);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isNotFoundError(error)) {
        console.warn("Gemini API returned a Not Found error. Not retrying.");
        if (error instanceof Error) {
            if (error.message.startsWith("Gemini API error:") || error.message.includes("API_KEY") || error.message.includes("Rpc failed")) {
                throw error; 
            }
            throw new Error(`Gemini API error (Not Found): ${error.message}`);
        }
        throw new Error(`Gemini API error (Not Found): ${String(error)}`);
      }

      if (attempt < MAX_RETRIES) {
        const delayTime = (2 ** attempt) * INITIAL_RETRY_DELAY_MS;
        console.log(`Waiting ${delayTime}ms before next retry.`);
        await delay(delayTime);
      }
    }
  }

  console.error("Gemini API call failed after all retries.");
  if (lastError) {
    if (lastError.message.startsWith("Gemini API error:") || lastError.message.includes("API_KEY") || lastError.message.includes("Rpc failed")) {
        throw lastError;
    }
    throw new Error(`Gemini API error (after retries): ${lastError.message}`);
  }
  throw new Error("An unknown error occurred with the Gemini API after all retries.");
}
