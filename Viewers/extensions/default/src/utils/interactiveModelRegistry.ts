import axios from 'axios';

export type InteractiveModelId = string;
export type InteractiveModelProvider = 'builtin' | 'gateway';
export type TextPromptModelId = string;

export type ModelTask = 'interactive_segmentation' | 'text_prompt_segmentation';

export interface ModelSpecBase {
  id: string;
  displayName: string;
  provider: InteractiveModelProvider;
  capabilities: string[];
  default?: boolean;
}

export interface InteractiveModelSpec extends ModelSpecBase {
  task: 'interactive_segmentation';
}

export interface TextPromptModelSpec extends ModelSpecBase {
  task: 'text_prompt_segmentation';
}

export type TextModelLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unknown';

export interface TextModelStatus {
  model: string;
  state: TextModelLoadState;
  elapsed_s?: number;
  error?: string | null;
}

type ModelRegistryResponse = {
  models?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseModel(
  value: unknown,
  expectedTask: ModelTask
): InteractiveModelSpec | TextPromptModelSpec | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.task !== expectedTask
  ) {
    return undefined;
  }

  const provider: InteractiveModelProvider = value.provider === 'gateway' ? 'gateway' : 'builtin';
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(
        (capability): capability is string => typeof capability === 'string'
      )
    : [];

  return {
    id: value.id,
    displayName: typeof value.display_name === 'string' ? value.display_name : value.id,
    provider,
    task: expectedTask,
    capabilities,
    default: value.default === true,
  };
}

function parseTextModelStatus(value: unknown): TextModelStatus | undefined {
  if (!isRecord(value) || typeof value.model !== 'string' || typeof value.state !== 'string') {
    return undefined;
  }
  const state = value.state as TextModelLoadState;
  return {
    model: value.model,
    state,
    elapsed_s:
      typeof value.elapsed_s === 'number' ? value.elapsed_s : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

async function fetchModelsByTask(
  task: ModelTask,
  signal?: AbortSignal
): Promise<(InteractiveModelSpec | TextPromptModelSpec)[]> {
  const response = await axios.get<ModelRegistryResponse>('/monai/models/', {
    params: { task },
    signal,
    timeout: 15000,
  });

  if (!Array.isArray(response.data?.models)) {
    throw new Error('Model registry returned an invalid response');
  }

  return response.data.models
    .map(value => parseModel(value, task))
    .filter((model): model is InteractiveModelSpec | TextPromptModelSpec => !!model);
}

export async function fetchInteractiveModels(
  signal?: AbortSignal
): Promise<InteractiveModelSpec[]> {
  const models = await fetchModelsByTask('interactive_segmentation', signal);
  return models as InteractiveModelSpec[];
}

export function getInteractiveModelDisplayName(
  models: InteractiveModelSpec[],
  modelId: InteractiveModelId
): string {
  return models.find(model => model.id === modelId)?.displayName ?? modelId;
}

/** Models offered by the 文本提示分割 toolbox. Text models are large and are
 *  NOT loaded by default — the user must click "加载模型" first (backend signal
 *  via /monai/text/model/{id}/status). */
export async function fetchTextPromptModels(
  signal?: AbortSignal
): Promise<TextPromptModelSpec[]> {
  const models = await fetchModelsByTask('text_prompt_segmentation', signal);
  return models as TextPromptModelSpec[];
}

export function getTextPromptModelDisplayName(
  models: TextPromptModelSpec[],
  modelId: TextPromptModelId
): string {
  return models.find(model => model.id === modelId)?.displayName ?? modelId;
}

/** Backend-reported load state of one text-prompt model. */
export async function fetchTextModelStatus(
  modelId: TextPromptModelId,
  signal?: AbortSignal
): Promise<TextModelStatus> {
  const response = await axios.get<unknown>(
    `/monai/text/model/${encodeURIComponent(modelId)}/status`,
    { signal, timeout: 15000 }
  );
  const status = parseTextModelStatus(response.data);
  if (!status) {
    throw new Error('Text model status endpoint returned an invalid response');
  }
  return status;
}

/** Ask the backend to start loading a text-prompt model. Returns immediately;
 *  poll fetchTextModelStatus until state becomes 'ready' | 'error'. */
export async function startTextModelLoad(
  modelId: TextPromptModelId
): Promise<TextModelStatus> {
  const response = await axios.post<unknown>(
    `/monai/text/model/${encodeURIComponent(modelId)}/load`,
    undefined,
    { timeout: 20000 }
  );
  const status = parseTextModelStatus(response.data);
  if (!status) {
    throw new Error('Text model load endpoint returned an invalid response');
  }
  return status;
}
