declare module './gemini.service' {
  export function callGemini(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './groq.service' {
  export function callGroq(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './mistral.service' {
  export function callMistral(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './cohere.service' {
  export function callCohere(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './openai.service' {
  export function callOpenAI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './claude.service' {
  export function callClaude(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './openrouter.service' {
  export function callOpenRouter(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './together.service' {
  export function callTogether(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './anyapi.service' {
  export function callAnyAPI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null): Promise<any>;
}

declare module './deepseek.service' {
  export function calldeepseekAPI(modelName: string, apiKey: string, messages: any[], signal?: AbortSignal | null, modelConfig?: any): Promise<any>;
}

declare module './ai/dispatcher.service' {
  export function dispatchToAI(modelConfig: any, messages: any[], signal?: AbortSignal | null): Promise<any>;
}
