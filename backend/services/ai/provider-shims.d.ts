declare module './gemini.service' {
  export function callGemini(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callGeminiStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './groq.service' {
  export function callGroq(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callGroqStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './mistral.service' {
  export function callMistral(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callMistralStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './cohere.service' {
  export function callCohere(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callCohereStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './openai.service' {
  export function callOpenAI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callOpenAIStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './claude.service' {
  export function callClaude(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callClaudeStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './openrouter.service' {
  export function callOpenRouter(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callOpenRouterStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './together.service' {
  export function callTogether(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callTogetherStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './anyapi.service' {
  export function callAnyAPI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function callAnyAPIStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}

declare module './deepseek.service' {
  export function calldeepseekAPI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, modelConfig?: any): Promise<any>;
  export function calldeepseekAPIStream(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, modelConfig?: any, onChunk?: (text: string) => void): Promise<any>;
}

declare module './unified.service' {
  export function callOpenAICompatible(options: any): Promise<any>;
  export function callOpenAICompatibleStream(options: any): Promise<any>;
}

declare module './ai/dispatcher.service' {
  export function dispatchToAI(modelConfig: any, messages: any[], signal?: AbortSignal | null): Promise<any>;
  export function dispatchToAIStream(modelConfig: any, messages: any[], signal?: AbortSignal | null, onChunk?: (text: string) => void): Promise<any>;
}
