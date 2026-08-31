import axios from 'axios';

export type InteractiveModelId = string;
export type InteractiveModelProvider = 'builtin' | 'gateway';

export interface InteractiveModelSpec {
  id: InteractiveModelId;
  displayName: string;
  provider: InteractiveModelProvider;
  task: 'interactive_segmentation';
  capabilities: string[];
  default?: boolean;
}

type ModelRegistryResponse = {
  models?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseModel(value: unknown): InteractiveModelSpec | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.task !== 'interactive_segmentation'
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
    task: 'interactive_segmentation',
    capabilities,
    default: value.default === true,
  };
}

export async function fetchInteractiveModels(
  signal?: AbortSignal
): Promise<InteractiveModelSpec[]> {
  const response = await axios.get<ModelRegistryResponse>('/monai/models/', {
    signal,
    timeout: 15000,
  });

  if (!Array.isArray(response.data?.models)) {
    throw new Error('Model registry returned an invalid response');
  }

  return response.data.models
    .map(parseModel)
    .filter((model): model is InteractiveModelSpec => !!model);
}

export function getInteractiveModelDisplayName(
  models: InteractiveModelSpec[],
  modelId: InteractiveModelId
): string {
  return models.find(model => model.id === modelId)?.displayName ?? modelId;
}
