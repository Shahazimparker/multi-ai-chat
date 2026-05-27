// ============================================================
// FILE: backend/services/promptTemplate.service.js
// PURPOSE: Reusable prompt templates with variable interpolation
//          - PromptTemplate: basic template with variables
//          - FewShotTemplate: add examples
//          - ChatTemplate: multi-turn conversations
//          - ConditionalTemplate: if/else logic
//          - TemplateRegistry: centralized management
// ============================================================

/**
 * PromptTemplate — basic reusable prompt
 */
class PromptTemplate {
  constructor(options = {}) {
    this.name = options.name || 'unnamed';
    this.template = options.template || '';
    this.variables = options.variables || [];
    this.description = options.description || '';
    this.metadata = options.metadata || {};
    this.version = options.version || '1.0';
  }

  /**
   * Validate all required variables are provided
   */
  _validateVariables(values) {
    const missing = [];
    for (const variable of this.variables) {
      if (!(variable in values)) {
        missing.push(variable);
      }
    }
    return missing.length === 0 ? true : missing;
  }

  /**
   * Format template with provided variables
   */
  async format(values = {}) {
    // Validate
    const missing = this._validateVariables(values);
    if (missing !== true) {
      throw new Error(`Missing variables: ${missing.join(', ')}`);
    }

    // Replace variables
    let result = this.template;
    for (const [key, value] of Object.entries(values)) {
      const placeholder = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(placeholder, String(value));
    }

    return result;
  }

  /**
   * Preview template with sample values
   */
  preview(sampleValues = {}) {
    let preview = this.template;

    // Use provided samples
    for (const variable of this.variables) {
      const value = sampleValues[variable] || `<${variable}>`;
      const placeholder = new RegExp(`\\{${variable}\\}`, 'g');
      preview = preview.replace(placeholder, String(value));
    }

    return preview;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      template: this.template,
      variables: this.variables,
      version: this.version,
      metadata: this.metadata,
    };
  }
}

/**
 * FewShotTemplate — template with example inputs/outputs
 */
class FewShotTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.examples = options.examples || [];
    this.examplePrompt = options.examplePrompt || null;
    this.exampleSeparator = options.exampleSeparator || '\n\n---\n\n';
  }

  /**
   * Format examples section
   */
  async _formatExamples(variables = {}) {
    if (this.examples.length === 0) return '';

    const formattedExamples = [];

    for (const example of this.examples) {
      if (this.examplePrompt) {
        // Use examplePrompt template
        const formatted = await this.examplePrompt.format(example);
        formattedExamples.push(formatted);
      } else {
        // Simple key-value format
        const parts = [];
        for (const [key, value] of Object.entries(example)) {
          parts.push(`${key}: ${value}`);
        }
        formattedExamples.push(parts.join('\n'));
      }
    }

    return formattedExamples.join(this.exampleSeparator);
  }

  async format(values = {}) {
    const basePrompt = await super.format(values);
    const examples = await this._formatExamples(values);

    if (examples) {
      return `${examples}${this.exampleSeparator}${basePrompt}`;
    }

    return basePrompt;
  }

  addExample(example) {
    this.examples.push(example);
    return this;
  }

  removeExample(index) {
    this.examples.splice(index, 1);
    return this;
  }
}

/**
 * ChatTemplate — template for multi-turn conversations
 */
class ChatTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.messages = options.messages || [];
    // messages: [{ role: 'system', content: '...' }, { role: 'user', content: '...' }]
  }

  async format(values = {}) {
    const formattedMessages = [];

    for (const message of this.messages) {
      let content = message.content;

      // Replace variables in content
      for (const [key, value] of Object.entries(values)) {
        const placeholder = new RegExp(`\\{${key}\\}`, 'g');
        content = content.replace(placeholder, String(value));
      }

      formattedMessages.push({
        role: message.role,
        content,
      });
    }

    return formattedMessages;
  }

  addMessage(role, content) {
    this.messages.push({ role, content });
    return this;
  }

  preview(sampleValues = {}) {
    const messages = [];
    for (const message of this.messages) {
      let content = message.content;
      for (const variable of this.variables) {
        const value = sampleValues[variable] || `<${variable}>`;
        const placeholder = new RegExp(`\\{${variable}\\}`, 'g');
        content = content.replace(placeholder, String(value));
      }
      messages.push({ role: message.role, content });
    }
    return messages;
  }
}

/**
 * ConditionalTemplate — template with if/else logic
 */
class ConditionalTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.conditions = options.conditions || [];
    // conditions: [{ test: (values) => bool, template: '...' }]
    this.defaultTemplate = options.defaultTemplate || '';
  }

  async format(values = {}) {
    // Test conditions in order
    for (const condition of this.conditions) {
      if (await condition.test(values)) {
        const template = new PromptTemplate({
          template: condition.template,
          variables: this.variables,
        });
        return await template.format(values);
      }
    }

    // Use default if no conditions match
    const defaultTemplate = new PromptTemplate({
      template: this.defaultTemplate,
      variables: this.variables,
    });
    return await defaultTemplate.format(values);
  }

  addCondition(test, template) {
    this.conditions.push({ test, template });
    return this;
  }
}

/**
 * TemplateRegistry — centralized template management
 */
class TemplateRegistry {
  constructor() {
    this.templates = new Map();
    this.versions = new Map(); // name → [version1, version2, ...]
    this._initializeBuiltins();
  }

  /**
   * Initialize built-in templates
   */
  _initializeBuiltins() {
    // QA template
    this.register(
      new PromptTemplate({
        name: 'qa',
        description: 'Question answering template',
        template: `Answer the following question based on the provided context.

Context:
{context}

Question: {question}

Answer:`,
        variables: ['context', 'question'],
      })
    );

    // Summarization template
    this.register(
      new PromptTemplate({
        name: 'summarize',
        description: 'Text summarization template',
        template: `Summarize the following text in {style} style:

Text:
{text}

Summary:`,
        variables: ['text', 'style'],
      })
    );

    // Classification template
    this.register(
      new PromptTemplate({
        name: 'classify',
        description: 'Text classification template',
        template: `Classify the following text into one of these categories: {categories}

Text:
{text}

Classification:`,
        variables: ['text', 'categories'],
      })
    );

    // Analysis template
    this.register(
      new PromptTemplate({
        name: 'analyze',
        description: 'Data analysis template',
        template: `Analyze the following data:

Data:
{data}

Analysis focus: {focus}

Analysis:`,
        variables: ['data', 'focus'],
      })
    );

    // Extraction template
    this.register(
      new PromptTemplate({
        name: 'extract',
        description: 'Information extraction template',
        template: `Extract {entities} from the following text:

Text:
{text}

Extracted information:`,
        variables: ['text', 'entities'],
      })
    );

    // Code review template
    this.register(
      new PromptTemplate({
        name: 'code_review',
        description: 'Code review template',
        template: `Review the following code for {focus}:

Code:
\`\`\`{language}
{code}
\`\`\`

Review:`,
        variables: ['code', 'language', 'focus'],
      })
    );

    // Agent reasoning template
    this.register(
      new ChatTemplate({
        name: 'agent_reason',
        description: 'Agent reasoning template',
        variables: ['goal', 'tools', 'memory'],
        messages: [
          {
            role: 'system',
            content: `You are a helpful AI agent. Use the available tools to solve problems.
Available tools: {tools}

Follow ReAct pattern:
1. Thought: What should I do?
2. Action: {"tool": "name", "args": {...}}
3. Observation: What did the tool return?`,
          },
          {
            role: 'user',
            content: `Goal: {goal}\n\nMemory:\n{memory}`,
          },
        ],
      })
    );
  }

  /**
   * Register template
   */
  register(template) {
    const name = template.name;

    // Store template
    this.templates.set(name, template);

    // Track version
    if (!this.versions.has(name)) {
      this.versions.set(name, []);
    }
    this.versions.get(name).push({
      version: template.version,
      timestamp: new Date().toISOString(),
      template,
    });

    return this;
  }

  /**
   * Get template by name
   */
  get(name) {
    return this.templates.get(name);
  }

  /**
   * Get template version
   */
  getVersion(name, version) {
    const versions = this.versions.get(name) || [];
    return versions.find((v) => v.version === version)?.template || null;
  }

  /**
   * List all templates
   */
  list() {
    return Array.from(this.templates.values()).map((t) => ({
      name: t.name,
      description: t.description,
      version: t.version,
      variables: t.variables,
    }));
  }

  /**
   * Get template metadata
   */
  getInfo(name) {
    const template = this.get(name);
    if (!template) return null;

    return {
      name: template.name,
      description: template.description,
      version: template.version,
      variables: template.variables,
      versions: (this.versions.get(name) || []).map((v) => v.version),
      preview: template.preview(),
    };
  }

  /**
   * Clone template
   */
  clone(name, newName) {
    const template = this.get(name);
    if (!template) return null;

    const cloned = Object.assign(
      Object.create(Object.getPrototypeOf(template)),
      template
    );
    cloned.name = newName;
    this.register(cloned);
    return cloned;
  }

  /**
   * Delete template
   */
  delete(name) {
    this.templates.delete(name);
    this.versions.delete(name);
  }
}

/**
 * FormattedOutputTemplate — enforce specific output format
 */
class FormattedOutputTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.outputFormat = options.outputFormat || 'json'; // json, csv, xml, markdown, text
    this.schema = options.schema || null;
    this.formatInstructions = options.formatInstructions || this._getFormatInstructions();
  }

  _getFormatInstructions() {
    const formats = {
      json: `Respond with valid JSON format. Schema: ${JSON.stringify(this.schema)}`,
      csv: 'Respond with CSV format: header,value1,value2',
      xml: 'Respond with valid XML format',
      markdown: 'Respond with markdown format (headers, lists, bold, etc)',
      text: 'Respond with plain text',
    };

    return formats[this.outputFormat] || formats.text;
  }

  async format(values = {}) {
    const basePrompt = await super.format(values);
    return `${basePrompt}\n\nFormat: ${this.outputFormat}\n${this.formatInstructions}`;
  }
}

/**
 * RoleTemplate — different prompts for different roles
 */
class RoleTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.roles = options.roles || {}; // { expert: '...', beginner: '...', ... }
    this.defaultRole = options.defaultRole || 'default';
  }

  async format(values = {}) {
    const role = values.role || this.defaultRole;
    let template = this.roles[role] || this.roles[this.defaultRole];

    if (!template) {
      throw new Error(
        `Role "${role}" not found. Available: ${Object.keys(this.roles).join(', ')}`
      );
    }

    // Replace variables
    for (const [key, value] of Object.entries(values)) {
      if (key !== 'role') {
        const placeholder = new RegExp(`\\{${key}\\}`, 'g');
        template = template.replace(placeholder, String(value));
      }
    }

    return template;
  }

  addRole(roleName, templateText) {
    this.roles[roleName] = templateText;
    return this;
  }

  getRoles() {
    return Object.keys(this.roles);
  }
}

/**
 * LoopTemplate — iterative refinement
 */
class LoopTemplate extends PromptTemplate {
  constructor(options = {}) {
    super(options);
    this.initialTemplate = options.initialTemplate || options.template;
    this.refinementTemplate = options.refinementTemplate || 'Improve the previous response based on this feedback: {feedback}';
    this.maxIterations = options.maxIterations || 3;
    this.stopCondition = options.stopCondition || null; // (result) => boolean
    this.modelDispatcher = options.modelDispatcher || null;
  }

  async executeLoop(values = {}, modelDispatcher = null) {
    const dispatcher = modelDispatcher || this.modelDispatcher;
    if (!dispatcher) {
      throw new Error('modelDispatcher required for loop execution');
    }

    let currentPrompt = await new PromptTemplate({
      template: this.initialTemplate,
      variables: this.variables,
    }).format(values);

    const iterations = [];

    for (let i = 0; i < this.maxIterations; i++) {
      try {
        // Execute current prompt
        const response = await dispatcher.dispatch({
          modelId: values.modelId || 'claude-3-5-sonnet',
          messages: [{ role: 'user', content: currentPrompt }],
        });

        const result = response.text || response.content;
        iterations.push({
          iteration: i + 1,
          prompt: currentPrompt,
          result,
        });

        // Check stop condition
        if (this.stopCondition && (await this.stopCondition(result, i + 1))) {
          return {
            success: true,
            finalResult: result,
            iterations: iterations.length,
            allIterations: iterations,
          };
        }

        // Prepare next iteration
        if (i < this.maxIterations - 1) {
          currentPrompt = this.refinementTemplate.replace(
            '{feedback}',
            'Current result: ' + result.slice(0, 200)
          );
        }
      } catch (err) {
        return {
          success: false,
          error: err.message,
          iterations: i,
          allIterations: iterations,
        };
      }
    }

    return {
      success: true,
      finalResult: iterations[iterations.length - 1]?.result,
      iterations: iterations.length,
      allIterations: iterations,
      reachedMaxIterations: true,
    };
  }

  async format(values = {}) {
    // For non-looping use, just return initial template
    return await new PromptTemplate({
      template: this.initialTemplate,
      variables: this.variables,
    }).format(values);
  }
}

/**
 * PromptComposer — compose multiple templates
 */
class PromptComposer {
  constructor() {
    this.templates = [];
  }

  add(template) {
    this.templates.push(template);
    return this;
  }

  async compose(values = {}) {
    const parts = [];

    for (const template of this.templates) {
      const formatted = await template.format(values);
      parts.push(formatted);
    }

    return parts.join('\n\n');
  }
}

/**
 * Global template registry
 */
let globalRegistry = null;

const getGlobalRegistry = () => {
  if (!globalRegistry) {
    globalRegistry = new TemplateRegistry();
  }
  return globalRegistry;
};

module.exports = {
  PromptTemplate,
  FewShotTemplate,
  ChatTemplate,
  ConditionalTemplate,
  FormattedOutputTemplate,
  RoleTemplate,
  LoopTemplate,
  PromptComposer,
  TemplateRegistry,
  getGlobalRegistry,
};
