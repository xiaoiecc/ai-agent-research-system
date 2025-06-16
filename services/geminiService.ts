
import { GoogleGenAI, GenerateContentResponse, Content, GenerateContentParameters, GroundingMetadata, Part, Tool, GenerationConfig, SystemInstruction } from "@google/genai";
import { MODEL_MAP } from '../constants'; 
import { ModelMode } from '../types';

// Ensure API_KEY is available. In a real build, this would be populated.
if (!process.env.API_KEY) {
  console.warn("API_KEY environment variable not set. Gemini API calls will likely fail. Please ensure it is set in your environment.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

function parseGeneratedContentResponse(response: GenerateContentResponse): { text: string; groundingMetadata?: GroundingMetadata } {
  let combinedText = "";
  let groundingMetadata: GroundingMetadata | undefined = undefined;

  const candidate = response.candidates?.[0];

  if (candidate) {
    groundingMetadata = candidate.groundingMetadata;

    if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
      candidate.content.parts.forEach(part => {
        if (part.text && typeof part.text === 'string') {
          combinedText += part.text + "\n";
        }
        if (part.executableCode?.code && typeof part.executableCode.code === 'string') {
          combinedText += "\n--- 代码段 ---\n```python\n" + part.executableCode.code + "\n```\n";
        }
        if (part.codeExecutionResult?.output && typeof part.codeExecutionResult.output === 'string') {
          combinedText += "\n--- 代码执行结果 ---\n```\n" + part.codeExecutionResult.output + "\n```\n";
        }
      });
    }
  }

  if (combinedText.trim() === "") {
    try {
      // Assuming response.text() is a method as per the subtask's specific instruction.
      // This might differ from the GenerateContentResponse type, which lists `text` as an optional property.
      const textFromMethod = (response as any).text();
      if (textFromMethod && typeof textFromMethod === 'string' && textFromMethod.trim() !== "") {
        combinedText = textFromMethod;
      }
    } catch (e) {
      console.warn("Warning: response.text() method failed or returned empty.", e);
      // If response.text() fails, and parts were empty, combinedText remains empty.
      // We can check for response.text as a property as a final fallback if desired,
      // but the current instruction is to use the method.
      // if (response.text && typeof response.text === 'string' && response.text.trim() !== "") {
      //   console.warn("Warning: response.text() method failed, falling back to response.text property.");
      //   combinedText = response.text;
      // }
    }
  }

  return { text: combinedText.trim(), groundingMetadata };
}

const MAX_RETRIES = 6;
const INITIAL_RETRY_DELAY_MS = 600;

// Helper function for async delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Function to check if an error message indicates a 404 Not Found error
function isNotFoundError(error: any): boolean {
  if (error && typeof error.status === 'number' && error.status === 404) {
    return true;
  }
  if (error && error.message && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    if (message.includes('404')) {
      return true;
    }
    if (message.includes('not found')) {
      return true;
    }
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

  if (!process.env.API_KEY) {
     console.error("API_KEY is not configured. Cannot call Gemini API.");
     throw new Error("API_KEY is not configured. Cannot call Gemini API.");
  }
  
  const modelName = MODEL_MAP[modelMode];

  if (!process.env.API_KEY) {
     console.error("API_KEY is not configured. Cannot call Gemini API.");
     throw new Error("API_KEY is not configured. Cannot call Gemini API.");
  }
  
  const tools: Tool[] = [];
  let generationConfig: GenerationConfig | undefined = undefined;

  if (useGoogleSearch) {
    tools.push({googleSearch: {}});
    // Warning for Google Search + JSON output is handled below after all configs are set.
  } else if (useCodeExecution) {
    tools.push({codeExecution: {}});
    if (expectJsonOutput) {
      // According to documentation, responseMimeType can be set with codeExecution.
      generationConfig = { responseMimeType: "application/json" };
    }
  } else if (expectJsonOutput) {
    generationConfig = { responseMimeType: "application/json" };
  }

  const generateContentRequest: GenerateContentParameters = {
    model: modelName,
    contents: [{role: "user", parts: [{text: prompt}]}], // Ensure contents is an array of Content objects
  };

  if (systemInstruction) {
    // The type for systemInstruction in GenerateContentParameters is SystemInstruction, which can be string | Content
    // If systemInstruction is just a string, the library handles wrapping it.
    generateContentRequest.systemInstruction = systemInstruction;
  }

  if (tools.length > 0) {
    generateContentRequest.tools = tools;
  }

  if (generationConfig) {
    generateContentRequest.generationConfig = generationConfig;
  }

  // Handle warning for Google Search and JSON output
  if (useGoogleSearch && generateContentRequest.generationConfig?.responseMimeType === "application/json") {
    console.warn("Google Search and JSON output requested simultaneously. `responseMimeType` for JSON is set, but might be ignored by the model when Google Search tool is active, as per Gemini API guidelines. The model will handle JSON output based on the prompt if capable.");
    // Optionally, remove the mime type if it's strictly forbidden:
    // delete generateContentRequest.generationConfig.responseMimeType;
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
