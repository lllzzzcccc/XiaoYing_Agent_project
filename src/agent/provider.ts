import { createModels, type Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { PiAgentRunOptions } from "./pi-agent.js";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const providerFactories: Record<string, () => Provider<any>> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
  deepseek: deepseekProvider,
};

export function createRealRuntime(env: NodeJS.ProcessEnv): Pick<PiAgentRunOptions, "model" | "streamFn"> {
  const providerId = env.CONTENT_PLANNER_PROVIDER;
  const modelId = env.CONTENT_PLANNER_MODEL;
  if (!providerId || !modelId) {
    throw new ConfigurationError("真实模式需要 CONTENT_PLANNER_PROVIDER 和 CONTENT_PLANNER_MODEL");
  }
  const factory = providerFactories[providerId];
  if (!factory) throw new ConfigurationError(`不支持的 Provider: ${providerId}`);

  const models = createModels();
  models.setProvider(factory());
  const model = models.getModel(providerId, modelId);
  if (!model) throw new ConfigurationError(`Provider ${providerId} 中找不到模型 ${modelId}`);
  return { model, streamFn: models.streamSimple.bind(models) };
}
