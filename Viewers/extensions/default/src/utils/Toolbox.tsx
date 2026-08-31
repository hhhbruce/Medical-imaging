import React, { useState, useEffect, useRef } from 'react';
import {
  Icons,
  PanelSection,
  ToolSettings,
  Switch,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
  Input,
} from '@ohif/ui-next';
import { Lock, LockOpen } from 'lucide-react';
import { useSystem, useToolbar } from '@ohif/core';
import classnames from 'classnames';
import { useTranslation } from 'react-i18next';
import {
  toolboxState,
  type VlmProviderId,
  type VllmFamilyId,
  type VllmThinkingLevel,
  type MedgemmaVariantId,
  type CustomEndpointType,
  type CustomMasStrategy,
} from '../stores/toolboxState';
import {
  fetchInteractiveModels,
  getInteractiveModelDisplayName,
  type InteractiveModelId,
  type InteractiveModelSpec,
} from './interactiveModelRegistry';

interface ButtonProps {
  isActive?: boolean;
  options?: unknown;
}

type ModelSwitchResult = {
  status: 'ready' | 'error' | 'superseded';
  model: InteractiveModelId;
  message?: string;
};

/**
 * A toolbox is a collection of buttons and commands that they invoke, used to provide
 * custom control panels to users. This component is a generic UI component that
 * interacts with services and commands in a generic fashion. While it might
 * seem unconventional to import it from the UI and integrate it into the JSX,
 * it belongs in the UI components as there isn't anything in this component that
 * couldn't be used for a completely different type of app. It plays a crucial
 * role in enhancing the app with a toolbox by providing a way to integrate
 * and display various tools and their corresponding options
 */
export function Toolbox({
  buttonSectionId,
  title,
  defaultOpen = true,
}: {
  buttonSectionId: string;
  title: string;
  defaultOpen?: boolean;
}) {
  const { servicesManager, commandsManager, hotkeysManager } = useSystem();
  const { t } = useTranslation();

  const {
    toolbarService,
    customizationService,
    segmentationService,
    viewportGridService,
    measurementService,
  } = servicesManager.services;
  const onInteractionRef = React.useRef<((args: { itemId: string }) => void) | null>(null);
  const isAIToolBox = buttonSectionId === 'aiToolBox';
  const isTextPromptToolbox = buttonSectionId === 'textPromptSegmentationToolbox';
  const isTestMedgemmaToolbox = buttonSectionId === 'testMedgemmaToolbox';
  const [showConfig, setShowConfig] = useState(false);
  const [isLocked, setIsLocked] = useState(toolboxState.getLocked());
  const hotkeysDisabled = isAIToolBox && isLocked;

  // Local state for UI updates
  const [liveMode, setLiveMode] = useState(toolboxState.getLiveMode());
  const [posNeg, setPosNeg] = useState(toolboxState.getPosNeg());
  const [textPromptReplaceNew, setTextPromptReplaceNew] = useState(
    toolboxState.getTextPromptReplaceNew()
  );
  const [selectedModel, setSelectedModel] = useState<InteractiveModelId>(
    toolboxState.getSelectedModel()
  );
  const [interactiveModels, setInteractiveModels] = useState<InteractiveModelSpec[]>([]);
  const [isModelRegistryLoading, setIsModelRegistryLoading] = useState(false);
  const [modelRegistryError, setModelRegistryError] = useState<string | null>(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const modelSwitchRequestRef = useRef(0);
  const modelSwitchPendingRef = useRef(false);
  const [medgemmaResult, setMedgemmaResult] = useState(toolboxState.getMedgemmaResult());
  const [medgemmaInstruction, setMedgemmaInstruction] = useState(
    toolboxState.getMedgemmaInstruction()
  );
  const [medgemmaQuery, setMedgemmaQuery] = useState(toolboxState.getMedgemmaQuery());
  const [medgemmaStartSlice, setMedgemmaStartSlice] = useState<number | null>(
    toolboxState.getMedgemmaStartSlice()
  );
  const [medgemmaEndSlice, setMedgemmaEndSlice] = useState<number | null>(
    toolboxState.getMedgemmaEndSlice()
  );
  const [geminiModel, setGeminiModel] = useState(toolboxState.getGeminiModel());
  const [geminiThinkingLevel, setGeminiThinkingLevel] = useState<'' | 'low' | 'medium' | 'high'>(
    toolboxState.getGeminiThinkingLevel()
  );
  const [openaiModel, setOpenaiModel] = useState(toolboxState.getOpenaiModel());
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState(
    toolboxState.getOpenaiReasoningEffort()
  );
  const [claudeModel, setClaudeModel] = useState(toolboxState.getClaudeModel());
  const [claudeThinkingEffort, setClaudeThinkingEffort] = useState(
    toolboxState.getClaudeThinkingEffort()
  );
  const [kimiModel, setKimiModel] = useState(toolboxState.getKimiModel());
  const [kimiReasoningEnabled, setKimiReasoningEnabled] = useState(
    toolboxState.getKimiReasoningEnabled()
  );
  const [qwenModel, setQwenModel] = useState(toolboxState.getQwenModel());
  const [qwenThinkingEnabled, setQwenThinkingEnabled] = useState(
    toolboxState.getQwenThinkingEnabled()
  );
  const [gemmaModel, setGemmaModel] = useState(toolboxState.getGemmaModel());
  const [gemmaThinkingEnabled, setGemmaThinkingEnabled] = useState(
    toolboxState.getGemmaThinkingEnabled()
  );
  const [vllmBaseUrl, setVllmBaseUrl] = useState(toolboxState.getVllmBaseUrl());
  const [vllmFamily, setVllmFamily] = useState<VllmFamilyId>(toolboxState.getVllmFamily());
  const [vllmThinkingLevel, setVllmThinkingLevel] = useState<VllmThinkingLevel>(
    toolboxState.getVllmThinkingLevel()
  );
  const [customBaseUrl, setCustomBaseUrl] = useState(toolboxState.getCustomBaseUrl());
  const [customApiKey, setCustomApiKey] = useState(toolboxState.getCustomApiKey());
  const [customEndpointType, setCustomEndpointType] = useState<CustomEndpointType>(
    toolboxState.getCustomEndpointType()
  );
  const [customModel, setCustomModel] = useState(toolboxState.getCustomModel());
  const [customMasStrategy, setCustomMasStrategy] = useState<CustomMasStrategy>(
    toolboxState.getCustomMasStrategy()
  );
  const [customModels, setCustomModels] = useState<string[]>(toolboxState.getCustomModels());
  const [customVisionModels, setCustomVisionModels] = useState<string[]>([]);
  const [customVisionCapabilitiesKnown, setCustomVisionCapabilitiesKnown] = useState(false);
  const [customModelsLoading, setCustomModelsLoading] = useState(false);
  const [customModelsError, setCustomModelsError] = useState('');
  const [vlmProvider, setVlmProvider] = useState(toolboxState.getVlmProvider());
  const [medgemmaVariant, setMedgemmaVariant] = useState<MedgemmaVariantId>(
    toolboxState.getMedgemmaVariant()
  );
  const [medgemmaThinkingEnabled, setMedgemmaThinkingEnabled] = useState(
    toolboxState.getMedgemmaThinkingEnabled()
  );

  const fetchCustomModels = async () => {
    if (!customBaseUrl?.trim()) {
      return;
    }
    setCustomModelsLoading(true);
    setCustomModelsError('');
    try {
      const result = (await commandsManager?.run('customListModels', {
        customBaseUrl: customBaseUrl?.trim(),
        customApiKey: customApiKey?.trim(),
        customEndpointType,
      })) as
        | {
            models?: string[];
            vision_models?: string[];
            vision_capabilities_known?: boolean;
            error?: string;
          }
        | undefined;
      if (result?.error) {
        setCustomModelsError(result.error);
        setCustomModels([]);
        setCustomVisionModels([]);
        setCustomVisionCapabilitiesKnown(false);
      } else {
        const models = result?.models ?? [];
        setCustomModels(models);
        setCustomVisionModels(result?.vision_models ?? []);
        setCustomVisionCapabilitiesKnown(result?.vision_capabilities_known === true);
        toolboxState.setCustomModels(models);
        if (models.length === 1) {
          setCustomModel(models[0]);
          toolboxState.setCustomModel(models[0]);
        }
      }
    } catch (error) {
      setCustomModelsError(error instanceof Error ? error.message : String(error));
      setCustomModels([]);
    } finally {
      setCustomModelsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAIToolBox) {
      return;
    }

    const controller = new AbortController();
    setIsModelRegistryLoading(true);
    setModelRegistryError(null);

    fetchInteractiveModels(controller.signal)
      .then(models => {
        if (models.length === 0) {
          throw new Error('No interactive segmentation models are registered');
        }

        setInteractiveModels(models);
        const currentModel = toolboxState.getSelectedModel();
        const currentModelIsRegistered = models.some(model => model.id === currentModel);
        if (!currentModelIsRegistered) {
          const defaultModel = models.find(model => model.default) ?? models[0];
          toolboxState.setSelectedModel(defaultModel.id);
          setSelectedModel(defaultModel.id);
        }
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Failed to load interactive model registry:', error);
        setModelRegistryError('模型注册表加载失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsModelRegistryLoading(false);
        }
      });

    return () => controller.abort();
  }, [isAIToolBox]);

  // Sync VLM toolbox state from toolboxState
  useEffect(() => {
    if (isTestMedgemmaToolbox) {
      const interval = setInterval(() => {
        const result = toolboxState.getMedgemmaResult();
        const instruction = toolboxState.getMedgemmaInstruction();
        const query = toolboxState.getMedgemmaQuery();
        const startSlice = toolboxState.getMedgemmaStartSlice();
        const endSlice = toolboxState.getMedgemmaEndSlice();
        const gm = toolboxState.getGeminiModel();
        const gtl = toolboxState.getGeminiThinkingLevel();
        const oam = toolboxState.getOpenaiModel();
        const oare = toolboxState.getOpenaiReasoningEffort();
        const cm = toolboxState.getClaudeModel();
        const cte = toolboxState.getClaudeThinkingEffort();
        const km = toolboxState.getKimiModel();
        const kre = toolboxState.getKimiReasoningEnabled();
        const qm = toolboxState.getQwenModel();
        const qte = toolboxState.getQwenThinkingEnabled();
        const gmm = toolboxState.getGemmaModel();
        const gte = toolboxState.getGemmaThinkingEnabled();
        const vbu = toolboxState.getVllmBaseUrl();
        const vf = toolboxState.getVllmFamily();
        const vtl = toolboxState.getVllmThinkingLevel();
        const vp = toolboxState.getVlmProvider();
        const mv = toolboxState.getMedgemmaVariant();
        const mte = toolboxState.getMedgemmaThinkingEnabled();
        const cbu = toolboxState.getCustomBaseUrl();
        const cak = toolboxState.getCustomApiKey();
        const cet = toolboxState.getCustomEndpointType();
        const cmodel = toolboxState.getCustomModel();
        const cms = toolboxState.getCustomMasStrategy();
        const cmodels = toolboxState.getCustomModels();
        setMedgemmaResult(result);
        setMedgemmaInstruction(instruction);
        setMedgemmaQuery(query);
        setMedgemmaStartSlice(startSlice);
        setMedgemmaEndSlice(endSlice);
        setGeminiModel(gm);
        setGeminiThinkingLevel(gtl);
        setOpenaiModel(oam);
        setOpenaiReasoningEffort(oare);
        setClaudeModel(cm);
        setClaudeThinkingEffort(cte);
        setKimiModel(km);
        setKimiReasoningEnabled(kre);
        setQwenModel(qm);
        setQwenThinkingEnabled(qte);
        setGemmaModel(gmm);
        setGemmaThinkingEnabled(gte);
        setVllmBaseUrl(vbu);
        setVllmFamily(vf);
        setVllmThinkingLevel(vtl);
        setVlmProvider(vp);
        setMedgemmaVariant(mv);
        setMedgemmaThinkingEnabled(mte);
        setCustomBaseUrl(cbu);
        setCustomApiKey(cak);
        setCustomEndpointType(cet);
        setCustomModel(cmodel);
        setCustomMasStrategy(cms);
        setCustomModels(cmodels);
      }, 100); // Check every 100ms for updates
      return () => clearInterval(interval);
    }
  }, [isTestMedgemmaToolbox]);

  // Sync local state with global state changes
  useEffect(() => {
    const updateLocalState = () => {
      setLiveMode(toolboxState.getLiveMode());
      setPosNeg(toolboxState.getPosNeg());
      setTextPromptReplaceNew(toolboxState.getTextPromptReplaceNew());
      if (!modelSwitchPendingRef.current) {
        setSelectedModel(toolboxState.getSelectedModel());
      }
      setIsLocked(toolboxState.getLocked());
    };

    // Update immediately
    updateLocalState();

    // Set up an interval to check for changes (since toolboxState doesn't have events)
    const interval = setInterval(updateLocalState, 100);

    return () => {
      clearInterval(interval);
      modelSwitchRequestRef.current += 1;
      modelSwitchPendingRef.current = false;
      // Reset volatile interaction state when the user leaves the viewer (e.g. back to study list).
      // This ensures the next mount always reads the default (positive) regardless of series UID.
      toolboxState.setPosNeg(false);
    };
  }, []);

  // Consolidated keyboard hotkey handler (AI toolbox only)
  // Q = Live Mode, T = Pos/Neg, P = Point, B = BBox, S = Scribble, L = Lasso
  // M = Add Segment, R = Reset Segment, O = Show/Hide Prompts
  useEffect(() => {
    if (!isAIToolBox || hotkeysDisabled) {
      return;
    }

    // Plain, structured-cloneable summary of a keydown — also what gets
    // forwarded to sibling OHIF windows via hotkeysManager.
    type AiKeyDescriptor = { key: string; ctrlKey: boolean; shiftKey: boolean };

    // Keys owned by the AI toolbox (must stay in sync with runAiKeyAction).
    const matchesAiKey = ({ key, ctrlKey, shiftKey }: AiKeyDescriptor) => {
      const k = key.toLowerCase();
      if (k === 'z') {
        return ctrlKey && !shiftKey;
      }
      return ['q', 't', 'p', 'b', 's', 'l', 'm', 'r', 'o', 'delete'].includes(k);
    };

    const runAiKeyAction = (descriptor: AiKeyDescriptor) => {
      switch (descriptor.key.toLowerCase()) {
        case 'q': {
          const newLiveMode = !toolboxState.getLiveMode();
          setLiveMode(newLiveMode);
          toolboxState.setLiveMode(newLiveMode);
          break;
        }
        case 't': {
          const newPosNeg = !toolboxState.getPosNeg();
          setPosNeg(newPosNeg);
          toolboxState.setPosNeg(newPosNeg);
          break;
        }
        case 'p':
          onInteractionRef.current?.({ itemId: 'Probe2' });
          break;
        case 'b':
          onInteractionRef.current?.({ itemId: 'RectangleROI2' });
          break;
        case 's':
          onInteractionRef.current?.({ itemId: 'PlanarFreehandROI2' });
          break;
        case 'l':
          onInteractionRef.current?.({ itemId: 'PlanarFreehandROI3' });
          break;
        case 'm': {
          const { activeViewportId: avId } = viewportGridService.getState();
          const activeSeg =
            segmentationService.getActiveSegmentation(avId) ??
            segmentationService.getSegmentations()?.[0];
          if (activeSeg?.segmentationId) {
            commandsManager.run('addSegment', { segmentationId: activeSeg.segmentationId });
            // Always start fresh in positive mode
            if (toolboxState.getPosNeg()) {
              toolboxState.setPosNeg(false);
            }
          }
          break;
        }
        case 'r': {
          const { activeViewportId: avId } = viewportGridService.getState();
          const activeSeg = segmentationService.getActiveSegmentation(avId);
          const activeSeg2 = segmentationService.getActiveSegment(avId);
          if (activeSeg?.segmentationId && activeSeg2?.segmentIndex != null) {
            commandsManager.run('resetSegment', {
              segmentationId: activeSeg.segmentationId,
              segmentIndex: activeSeg2.segmentIndex,
            });
          }
          break;
        }
        case 'o': {
          const next = !toolboxState.getPromptsVisible();
          toolboxState.setPromptsVisible(next);
          const AI_PROMPT_TOOLS = [
            'Probe2',
            'RectangleROI2',
            'PlanarFreehandROI2',
            'PlanarFreehandROI3',
          ];
          const uids = measurementService
            .getMeasurements()
            .filter(m => AI_PROMPT_TOOLS.includes(m.toolName))
            .map(m => m.uid);
          measurementService.toggleVisibilityMeasurementMany(uids, next);
          break;
        }
        case 'z': {
          if (descriptor.ctrlKey && !descriptor.shiftKey) {
            commandsManager.run('undoNninter');
          }
          break;
        }
        case 'delete': {
          const { activeViewportId: avId } = viewportGridService.getState();
          const activeSeg = segmentationService.getActiveSegmentation(avId);
          const activeSeg2 = segmentationService.getActiveSegment(avId);
          if (activeSeg?.segmentationId && activeSeg2?.segmentIndex != null) {
            const { segmentationId } = activeSeg;
            const { segmentIndex } = activeSeg2;
            const measurementUIDs = measurementService
              .getMeasurements()
              .filter(
                m =>
                  m?.metadata?.segmentationId === segmentationId &&
                  m?.metadata?.SegmentNumber === segmentIndex
              )
              .map(m => m?.uid);
            if (measurementUIDs.length > 0) measurementService.removeMany(measurementUIDs);
            commandsManager.run('resetNninter', { clearMeasurements: false });
            commandsManager.run('deleteSegment', { segmentationId, segmentIndex });
          }
          break;
        }
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputField =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement)?.contentEditable === 'true';
      if (isInputField) return;

      const descriptor: AiKeyDescriptor = {
        key: event.key,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
      };
      if (!matchesAiKey(descriptor)) return;

      event.preventDefault();
      event.stopPropagation();
      // Same follow-the-mouse routing as Mousetrap hotkeys: act here unless
      // a sibling OHIF window has the cursor — then hand the key to it.
      if (hotkeysManager.shouldRunLocally()) {
        runAiKeyAction(descriptor);
      } else {
        hotkeysManager.forwardKeyEvent(descriptor);
      }
    };

    // Keys forwarded from a sibling window while the cursor is over this one.
    const unsubscribeForwarded = hotkeysManager.subscribeForwardedKeys(descriptor => {
      if (matchesAiKey(descriptor)) {
        runAiKeyAction(descriptor);
      }
    });

    // Use capture phase so this fires before Mousetrap (bubble phase), preventing
    // global hotkey bindings from also firing for keys we own in the AI toolbox.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      unsubscribeForwarded();
    };
  }, [hotkeysDisabled, isAIToolBox]);

  // When locked, force Pan tool active, disable live prompts, and collapse section
  useEffect(() => {
    if (isLocked) {
      try {
        // Disable live mode to avoid unintended inference
        if (liveMode) {
          setLiveMode(false);
          toolboxState.setLiveMode(false);
        }
        // Activate Pan tool
        commandsManager?.run?.('setToolActive', { toolName: 'Pan' });
      } catch (e) {
        // no-op
      }
    }
  }, [isLocked]);

  const { toolbarButtons: toolboxSections, onInteraction } = useToolbar({
    servicesManager,
    buttonSection: buttonSectionId,
  });
  onInteractionRef.current = onInteraction;

  if (!toolboxSections.length) {
    return null;
  }

  // Ensure we have proper button sections at the top level.
  if (!toolboxSections.every(section => section.componentProps.buttonSection)) {
    throw new Error(
      'Toolbox accepts only button sections at the top level, not buttons. Create at least one button section.'
    );
  }

  // Helper to check a list of buttons for an active tool.
  const findActiveOptions = (buttons: any[]): unknown => {
    for (const tool of buttons) {
      if (tool.componentProps.isActive) {
        return tool.componentProps.options;
      }
      if (tool.componentProps.buttonSection) {
        const nestedButtons = toolbarService.getButtonPropsInButtonSection(
          tool.componentProps.buttonSection
        ) as ButtonProps[];
        const activeNested = nestedButtons.find(nested => nested.isActive);
        if (activeNested) {
          return activeNested.options;
        }
      }
    }
    return null;
  };

  // Look for active tool options across all sections.
  const activeToolOptions = toolboxSections.reduce((activeOptions, section) => {
    if (activeOptions) {
      return activeOptions;
    }
    const sectionId = section.componentProps.buttonSection;
    const buttons = toolbarService.getButtonSection(sectionId);
    return findActiveOptions(buttons);
  }, null);

  // Define the interaction handler once.
  const handleInteraction = ({ itemId }: { itemId: string }) => {
    if (isAIToolBox && isLocked && itemId !== 'Pan') {
      // Prevent tool changes when locked; keep Pan active
      commandsManager?.run?.('setToolActive', { toolName: 'Pan' });
      return;
    }
    onInteraction?.({ itemId });
  };

  const handleModelChange = async (model: InteractiveModelId) => {
    if (model === toolboxState.getSelectedModel() && !modelSwitchPendingRef.current) {
      return;
    }

    const requestId = ++modelSwitchRequestRef.current;
    modelSwitchPendingRef.current = true;
    setIsModelLoading(true);
    setSelectedModel(model);

    try {
      const result = (await commandsManager.run('switchInteractiveSegmentationModel', {
        model,
      })) as ModelSwitchResult | undefined;
      if (requestId !== modelSwitchRequestRef.current) {
        return;
      }

      if (result?.status === 'ready') {
        setSelectedModel(result.model);
      } else {
        // The global value changes only after backend confirmation, so this
        // restores the last usable model after failure or timeout.
        setSelectedModel(toolboxState.getSelectedModel());
      }
    } catch (error) {
      if (requestId === modelSwitchRequestRef.current) {
        console.error('Interactive model switch command failed:', error);
        setSelectedModel(toolboxState.getSelectedModel());
      }
    } finally {
      if (requestId === modelSwitchRequestRef.current) {
        modelSwitchPendingRef.current = false;
        setIsModelLoading(false);
      }
    }
  };

  const CustomConfigComponent = customizationService.getCustomization(`${buttonSectionId}.config`);
  const shouldCollapse = isAIToolBox && isLocked;

  return (
    <PanelSection
      key={isAIToolBox ? `toolbox-${isLocked}` : buttonSectionId}
      defaultOpen={defaultOpen && !shouldCollapse}
      className="border-border/80 bg-card/80 mx-2 mb-2 rounded-lg border shadow-[0_2px_8px_rgba(0,0,0,0.16)] first:mt-2"
    >
      <PanelSection.Header className="flex items-center justify-between">
        <span
          className={classnames('flex items-center gap-2', {
            'pointer-events-none': shouldCollapse,
          })}
        >
          <span className="pointer-events-auto">{t(title)}</span>
          {isAIToolBox && (
            <button
              type="button"
              className={classnames(
                'text-primary pointer-events-auto ml-auto h-5 w-5 cursor-pointer hover:opacity-80'
              )}
              onClick={e => {
                e.stopPropagation();
                const next = !isLocked;
                setIsLocked(next);
                toolboxState.setLocked(next);
                if (next) {
                  commandsManager?.run?.('setToolActive', { toolName: 'Pan' });
                }
              }}
              aria-label={isLocked ? '解锁工具' : '锁定工具'}
              title={isLocked ? '解锁工具' : '锁定工具'}
            >
              {isLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
            </button>
          )}
        </span>
        {CustomConfigComponent && (
          <div className="ml-auto mr-2">
            <Icons.Settings
              className="text-primary h-4 w-4"
              onClick={e => {
                e.stopPropagation();
                setShowConfig(!showConfig);
              }}
            />
          </div>
        )}
      </PanelSection.Header>

      {!shouldCollapse && (
        <PanelSection.Content className="bg-card flex-shrink-0 border-none">
          {showConfig && <CustomConfigComponent />}
          {toolboxSections.map(section => {
            const sectionId = section.componentProps.buttonSection;
            const buttons = toolbarService.getButtonSection(sectionId) as any[];

            return (
              <React.Fragment key={sectionId}>
                {isAIToolBox && (
                  <div className="bg-card border-border flex flex-col gap-3 border-b px-3 py-3">
                    {/* 第一步：选择分割模式（实时模式 / 正负提示） */}
                    <div className="flex flex-col gap-2">
                      <span className="text-muted-foreground text-[11px] font-medium tracking-wider">
                        分割模式
                      </span>
                      <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor="live-mode"
                            className="text-xs font-medium"
                          >
                            实时模式
                          </Label>
                          <div className="flex items-center gap-2">
                            <kbd className="border-border bg-card text-muted-foreground rounded border px-1 text-[10px]">
                              Q
                            </kbd>
                            <Switch
                              id="live-mode"
                              checked={liveMode}
                              onCheckedChange={checked => {
                                setLiveMode(checked);
                                toolboxState.setLiveMode(checked);
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor="pos-neg"
                            className="text-xs font-medium"
                          >
                            正/负提示
                          </Label>
                          <div className="flex items-center gap-2">
                            <kbd className="border-border bg-card text-muted-foreground rounded border px-1 text-[10px]">
                              T
                            </kbd>
                            <Switch
                              id="pos-neg"
                              checked={posNeg}
                              onCheckedChange={checked => {
                                setPosNeg(checked);
                                toolboxState.setPosNeg(checked);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 第二步：选择分割模型 */}
                    <div className="flex flex-col gap-2">
                      <span className="text-muted-foreground text-[11px] font-medium tracking-wider">
                        分割模型
                      </span>
                      <Select
                        value={selectedModel}
                        onValueChange={value => {
                          void handleModelChange(value);
                        }}
                      >
                        <SelectTrigger
                          id="model-selection"
                          className="w-full"
                          aria-busy={isModelLoading || isModelRegistryLoading}
                          disabled={isModelRegistryLoading || interactiveModels.length === 0}
                        >
                          <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {interactiveModels.map(model => (
                            <SelectItem
                              key={model.id}
                              value={model.id}
                            >
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isModelRegistryLoading && (
                        <span
                          className="text-primary text-xs"
                          role="status"
                          aria-live="polite"
                        >
                          加载模型列表…
                        </span>
                      )}
                      {!isModelRegistryLoading && modelRegistryError && (
                        <span
                          className="text-destructive text-xs"
                          role="alert"
                        >
                          {modelRegistryError}
                        </span>
                      )}
                      {isModelLoading && (
                        <span
                          className="text-primary text-xs"
                          role="status"
                          aria-live="polite"
                        >
                          正在加载{' '}
                          {getInteractiveModelDisplayName(interactiveModels, selectedModel)}…
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {isTextPromptToolbox && (
                  <div className="bg-muted/40 flex items-center justify-center gap-4 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="replace-new"
                        className="text-xs font-medium"
                      >
                        替换/新建
                      </Label>
                      <Switch
                        id="replace-new"
                        checked={textPromptReplaceNew}
                        onCheckedChange={checked => {
                          setTextPromptReplaceNew(checked);
                          toolboxState.setTextPromptReplaceNew(checked);
                          console.log('Replace/New:', checked);
                        }}
                      />
                    </div>
                  </div>
                )}
                {/* 第三步：绘制工具（点/涂抹/套索/框选） */}
                {isAIToolBox && (
                  <div className="px-3 pt-2">
                    <span className="text-muted-foreground text-[11px] font-medium tracking-wider">
                      绘制工具
                    </span>
                  </div>
                )}
                <div className="bg-muted/40 flex flex-wrap gap-1 px-3 py-2">
                  {buttons.map(tool => {
                    if (!tool) {
                      return null;
                    }
                    const { id, Component, componentProps } = tool;

                    // Hide testMedgemma button since we have input fields in the Toolbox
                    if (isTestMedgemmaToolbox && id === 'testMedgemma') {
                      return null;
                    }

                    return (
                      <div
                        key={id}
                        className={classnames('ml-1')}
                      >
                        <Component
                          {...componentProps}
                          id={id}
                          onInteraction={handleInteraction}
                          size="toolbox"
                          servicesManager={servicesManager}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* 实时模式关闭时显示"开始推理"按钮：独立一行、无图标、全宽长方形 */}
                {isAIToolBox && !liveMode && (
                  <div className="px-3 pt-1 pb-3">
                    <Button
                      onClick={() => commandsManager?.run('runAiSegmentation')}
                      className="w-full py-2.5 text-sm font-semibold"
                    >
                      <Icons.Play className="mr-2 h-4 w-4" />
                      开始推理
                    </Button>
                  </div>
                )}
                {isTestMedgemmaToolbox && (
                  <div className="border-primary/20 flex flex-col gap-3 border-t py-3 px-2">
                    <div className="flex flex-col gap-2">
                      <Label
                        htmlFor="vlm-provider"
                        className="text-sm font-semibold"
                      >
                        VLM 模型
                      </Label>
                      <Select
                        value={vlmProvider}
                        onValueChange={(value: VlmProviderId) => {
                          setVlmProvider(value);
                          toolboxState.setVlmProvider(value);
                        }}
                      >
                        <SelectTrigger
                          id="vlm-provider"
                          className="w-full"
                        >
                          <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="medGemma">MedGemma</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="claude">Claude</SelectItem>
                          <SelectItem value="kimi">Kimi (HF)</SelectItem>
                          <SelectItem value="qwen">Qwen (HF)</SelectItem>
                          <SelectItem value="gemma">Gemma 4 (HF)</SelectItem>
                          <SelectItem value="vllm">vLLM (OpenAI API)</SelectItem>
                          <SelectItem value="custom">自定义端点（base_url + API Key）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label
                        htmlFor="medgemma-instruction"
                        className="text-sm font-semibold"
                      >
                        指令（可选）
                      </Label>
                      <textarea
                        id="medgemma-instruction"
                        value={medgemmaInstruction}
                        onChange={e => {
                          const value = e.target.value;
                          setMedgemmaInstruction(value);
                          toolboxState.setMedgemmaInstruction(value);
                        }}
                        placeholder="输入指令（例如：'你是一位指导医学生的教师…'）"
                        className="bg-input/30 border-input placeholder:text-muted-foreground text-foreground min-h-[60px] resize-y rounded border p-2 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label
                        htmlFor="medgemma-query"
                        className="text-sm font-semibold"
                      >
                        查询
                      </Label>
                      <textarea
                        id="medgemma-query"
                        value={medgemmaQuery}
                        onChange={e => {
                          const value = e.target.value;
                          setMedgemmaQuery(value);
                          toolboxState.setMedgemmaQuery(value);
                        }}
                        placeholder="输入你的查询/问题"
                        className="bg-input/30 border-input placeholder:text-muted-foreground text-foreground min-h-[60px] resize-y rounded border p-2 text-sm"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label className="text-sm font-semibold">切片范围（可选）</Label>
                      <div className="flex gap-2">
                        <div className="flex flex-1 flex-col gap-1">
                          <Label
                            htmlFor="medgemma-start-slice"
                            className="text-muted-foreground text-xs"
                          >
                            起始切片（最小：1）
                          </Label>
                          <input
                            id="medgemma-start-slice"
                            type="number"
                            min="1"
                            value={medgemmaStartSlice ?? ''}
                            onChange={e => {
                              const value =
                                e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setMedgemmaStartSlice(value);
                              toolboxState.setMedgemmaStartSlice(value);
                            }}
                            placeholder="1"
                            className="bg-input/30 border-input placeholder:text-muted-foreground text-foreground rounded border p-2 text-sm"
                          />
                        </div>
                        <div className="flex flex-1 flex-col gap-1">
                          <Label
                            htmlFor="medgemma-end-slice"
                            className="text-muted-foreground text-xs"
                          >
                            结束切片（最大：总切片数）
                          </Label>
                          <input
                            id="medgemma-end-slice"
                            type="number"
                            min="1"
                            value={medgemmaEndSlice ?? ''}
                            onChange={e => {
                              const value =
                                e.target.value === '' ? null : parseInt(e.target.value, 10);
                              setMedgemmaEndSlice(value);
                              toolboxState.setMedgemmaEndSlice(value);
                            }}
                            placeholder="总切片数"
                            className="bg-input/30 border-input placeholder:text-muted-foreground text-foreground rounded border p-2 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                    {vlmProvider === 'medGemma' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="medgemma-variant"
                            className="text-sm font-semibold"
                          >
                            MedGemma 模型
                          </Label>
                          <Select
                            value={medgemmaVariant}
                            onValueChange={value => {
                              const v = value as MedgemmaVariantId;
                              setMedgemmaVariant(v);
                              toolboxState.setMedgemmaVariant(v);
                            }}
                          >
                            <SelectTrigger
                              id="medgemma-variant"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1.5-4b">1.5-4B</SelectItem>
                              <SelectItem value="27b">1-27b</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between gap-4 py-1">
                          <Label
                            htmlFor="medgemma-thinking"
                            className="text-sm font-semibold"
                          >
                            思考
                          </Label>
                          <Switch
                            id="medgemma-thinking"
                            checked={medgemmaThinkingEnabled}
                            onCheckedChange={checked => {
                              setMedgemmaThinkingEnabled(checked);
                              toolboxState.setMedgemmaThinkingEnabled(checked);
                            }}
                          />
                        </div>
                      </>
                    )}
                    {vlmProvider === 'gemini' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="gemini-model"
                            className="text-sm font-semibold"
                          >
                            Gemini 模型 ID（API）
                          </Label>
                          <Input
                            id="gemini-model"
                            type="text"
                            value={geminiModel}
                            onChange={e => {
                              const v = e.target.value;
                              setGeminiModel(v);
                              toolboxState.setGeminiModel(v);
                            }}
                            placeholder="例如 gemini-3-flash-preview"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="gemini-thinking-level"
                            className="text-sm font-semibold"
                          >
                            思考级别（推理）
                          </Label>
                          <Select
                            value={geminiThinkingLevel || 'default'}
                            onValueChange={value => {
                              const level =
                                value === 'default' ? '' : (value as 'low' | 'medium' | 'high');
                              setGeminiThinkingLevel(level);
                              toolboxState.setGeminiThinkingLevel(level);
                            }}
                          >
                            <SelectTrigger
                              id="gemini-thinking-level"
                              className="w-full"
                            >
                              <SelectValue placeholder="默认" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">默认（省略）</SelectItem>
                              <SelectItem value="low">低</SelectItem>
                              <SelectItem value="medium">中</SelectItem>
                              <SelectItem value="high">高</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {vlmProvider === 'openai' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="openai-model"
                            className="text-sm font-semibold"
                          >
                            OpenAI 模型 ID（API）
                          </Label>
                          <Input
                            id="openai-model"
                            type="text"
                            value={openaiModel}
                            onChange={e => {
                              const v = e.target.value;
                              setOpenaiModel(v);
                              toolboxState.setOpenaiModel(v);
                            }}
                            placeholder="例如 gpt-5.4"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="openai-reasoning-effort"
                            className="text-sm font-semibold"
                          >
                            推理力度
                          </Label>
                          <Input
                            id="openai-reasoning-effort"
                            type="text"
                            value={openaiReasoningEffort}
                            onChange={e => {
                              const v = e.target.value;
                              setOpenaiReasoningEffort(v);
                              toolboxState.setOpenaiReasoningEffort(v);
                            }}
                            placeholder="无、低、中、高（取决于模型）"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                      </>
                    )}
                    {vlmProvider === 'claude' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="claude-model"
                            className="text-sm font-semibold"
                          >
                            Claude 模型 ID（API）
                          </Label>
                          <Input
                            id="claude-model"
                            type="text"
                            value={claudeModel}
                            onChange={e => {
                              const v = e.target.value;
                              setClaudeModel(v);
                              toolboxState.setClaudeModel(v);
                            }}
                            placeholder="例如 claude-sonnet-4-20250514"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="claude-thinking-effort"
                            className="text-sm font-semibold"
                          >
                            思考力度（自适应）
                          </Label>
                          <Select
                            value={claudeThinkingEffort || 'default'}
                            onValueChange={value => {
                              const level =
                                value === 'default'
                                  ? ''
                                  : (value as 'low' | 'medium' | 'high' | 'max');
                              setClaudeThinkingEffort(level);
                              toolboxState.setClaudeThinkingEffort(level);
                            }}
                          >
                            <SelectTrigger
                              id="claude-thinking-effort"
                              className="w-full"
                            >
                              <SelectValue placeholder="默认" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">默认（省略）</SelectItem>
                              <SelectItem value="low">低</SelectItem>
                              <SelectItem value="medium">中</SelectItem>
                              <SelectItem value="high">高</SelectItem>
                              <SelectItem value="max">最高</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {vlmProvider === 'kimi' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="kimi-model"
                            className="text-sm font-semibold"
                          >
                            Kimi 模型 ID（HF）
                          </Label>
                          <Input
                            id="kimi-model"
                            type="text"
                            value={kimiModel}
                            onChange={e => {
                              const v = e.target.value;
                              setKimiModel(v);
                              toolboxState.setKimiModel(v);
                            }}
                            placeholder="例如 moonshotai/Kimi-K2.5:novita"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-4 py-1">
                          <Label
                            htmlFor="kimi-reasoning"
                            className="text-sm font-semibold"
                          >
                            思考
                          </Label>
                          <Switch
                            id="kimi-reasoning"
                            checked={kimiReasoningEnabled}
                            onCheckedChange={checked => {
                              setKimiReasoningEnabled(checked);
                              toolboxState.setKimiReasoningEnabled(checked);
                            }}
                          />
                        </div>
                      </>
                    )}
                    {vlmProvider === 'qwen' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="qwen-model"
                            className="text-sm font-semibold"
                          >
                            Qwen 模型 ID（HF）
                          </Label>
                          <Input
                            id="qwen-model"
                            type="text"
                            value={qwenModel}
                            onChange={e => {
                              const v = e.target.value;
                              setQwenModel(v);
                              toolboxState.setQwenModel(v);
                            }}
                            placeholder="例如 Qwen/Qwen3.5-397B-A17B:novita"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-4 py-1">
                          <Label
                            htmlFor="qwen-thinking"
                            className="text-sm font-semibold"
                          >
                            思考
                          </Label>
                          <Switch
                            id="qwen-thinking"
                            checked={qwenThinkingEnabled}
                            onCheckedChange={checked => {
                              setQwenThinkingEnabled(checked);
                              toolboxState.setQwenThinkingEnabled(checked);
                            }}
                          />
                        </div>
                      </>
                    )}
                    {vlmProvider === 'gemma' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="gemma-model"
                            className="text-sm font-semibold"
                          >
                            Gemma 模型 ID（HF）
                          </Label>
                          <Input
                            id="gemma-model"
                            type="text"
                            value={gemmaModel}
                            onChange={e => {
                              const v = e.target.value;
                              setGemmaModel(v);
                              toolboxState.setGemmaModel(v);
                            }}
                            placeholder="例如 google/gemma-4-31B-it:novita"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex items-center justify-between gap-4 py-1">
                          <Label
                            htmlFor="gemma-thinking"
                            className="text-sm font-semibold"
                          >
                            思考
                          </Label>
                          <Switch
                            id="gemma-thinking"
                            checked={gemmaThinkingEnabled}
                            onCheckedChange={checked => {
                              setGemmaThinkingEnabled(checked);
                              toolboxState.setGemmaThinkingEnabled(checked);
                            }}
                          />
                        </div>
                      </>
                    )}
                    {vlmProvider === 'vllm' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="vllm-base-url"
                            className="text-sm font-semibold"
                          >
                            vLLM 基础 URL（OpenAI 兼容，需包含 /v1）
                          </Label>
                          <Input
                            id="vllm-base-url"
                            type="text"
                            value={vllmBaseUrl}
                            onChange={e => {
                              const v = e.target.value;
                              setVllmBaseUrl(v);
                              toolboxState.setVllmBaseUrl(v);
                            }}
                            placeholder="http://host.docker.internal:8000/v1"
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="vllm-family"
                            className="text-sm font-semibold"
                          >
                            模型系列（可选）
                          </Label>
                          <Select
                            value={vllmFamily || 'auto'}
                            onValueChange={value => {
                              const fam = value === 'auto' ? '' : (value as VllmFamilyId);
                              setVllmFamily(fam);
                              toolboxState.setVllmFamily(fam);
                            }}
                          >
                            <SelectTrigger
                              id="vllm-family"
                              className="w-full"
                            >
                              <SelectValue placeholder="根据模型 ID 自动识别" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">自动（根据第一个模型 ID）</SelectItem>
                              <SelectItem value="internvl">InternVL</SelectItem>
                              <SelectItem value="qwen">Qwen</SelectItem>
                              <SelectItem value="kimi">Kimi</SelectItem>
                              <SelectItem value="gemma">Gemma</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="vllm-thinking-level"
                            className="text-sm font-semibold"
                          >
                            思考
                          </Label>
                          <Select
                            value={vllmThinkingLevel}
                            onValueChange={value => {
                              const level = value as VllmThinkingLevel;
                              setVllmThinkingLevel(level);
                              toolboxState.setVllmThinkingLevel(level);
                            }}
                          >
                            <SelectTrigger
                              id="vllm-thinking-level"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">关闭</SelectItem>
                              <SelectItem value="on">开启</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {vlmProvider === 'custom' && (
                      <>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="custom-endpoint-type"
                            className="text-sm font-semibold"
                          >
                            端点类型
                          </Label>
                          <Select
                            value={customEndpointType}
                            onValueChange={value => {
                              const type = value as CustomEndpointType;
                              setCustomEndpointType(type);
                              toolboxState.setCustomEndpointType(type);
                              // Endpoint switched → previously fetched models may be invalid.
                              setCustomModels([]);
                              setCustomModel('');
                              setCustomVisionModels([]);
                              setCustomVisionCapabilitiesKnown(false);
                              toolboxState.setCustomModels([]);
                              toolboxState.setCustomModel('');
                            }}
                          >
                            <SelectTrigger
                              id="custom-endpoint-type"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                              <SelectItem value="openai-chat">OpenAI Chat Completions</SelectItem>
                              <SelectItem value="anthropic">Anthropic Messages</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="custom-mas-strategy"
                            className="text-sm font-semibold"
                          >
                            多智能体模式
                          </Label>
                          <Select
                            value={customMasStrategy}
                            onValueChange={value => {
                              const strategy = value as CustomMasStrategy;
                              setCustomMasStrategy(strategy);
                              toolboxState.setCustomMasStrategy(strategy);
                            }}
                          >
                            <SelectTrigger
                              id="custom-mas-strategy"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="single">单模型（custom）</SelectItem>
                              <SelectItem value="discussion">Discussion 多轮讨论</SelectItem>
                              <SelectItem value="clinical-panel">临床专家小组</SelectItem>
                              <SelectItem value="triage-panel">急诊分诊小组</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-muted-foreground text-xs">
                            选择多智能体模式后，影像只在首轮发送，后续由文本汇总评审。
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="custom-base-url"
                            className="text-sm font-semibold"
                          >
                            Base URL
                          </Label>
                          <Input
                            id="custom-base-url"
                            type="text"
                            value={customBaseUrl}
                            onChange={e => {
                              const v = e.target.value;
                              setCustomBaseUrl(v);
                              toolboxState.setCustomBaseUrl(v);
                            }}
                            placeholder={
                              customEndpointType === 'anthropic'
                                ? 'https://api.anthropic.com'
                                : 'https://your-relay.example.com/v1'
                            }
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                          <p className="text-muted-foreground text-xs">
                            {customEndpointType === 'anthropic'
                              ? 'Anthropic 类型填 API 根地址（不含 /v1）'
                              : 'OpenAI 类型需包含 /v1'}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="custom-api-key"
                            className="text-sm font-semibold"
                          >
                            API Key
                          </Label>
                          <Input
                            id="custom-api-key"
                            type="password"
                            value={customApiKey}
                            onChange={e => {
                              const v = e.target.value;
                              setCustomApiKey(v);
                              toolboxState.setCustomApiKey(v);
                            }}
                            placeholder="sk-..."
                            className="bg-input/30 border-input text-foreground border text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchCustomModels}
                            disabled={!customBaseUrl?.trim() || customModelsLoading}
                            className="w-full"
                          >
                            {customModelsLoading ? '获取中…' : '获取模型列表'}
                          </Button>
                          {customModelsError && (
                            <p className="text-destructive break-all text-xs">
                              {customModelsError}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label
                            htmlFor="custom-model"
                            className="text-sm font-semibold"
                          >
                            模型
                          </Label>
                          <Select
                            value={customModel}
                            onValueChange={value => {
                              setCustomModel(value);
                              toolboxState.setCustomModel(value);
                            }}
                          >
                            <SelectTrigger
                              id="custom-model"
                              className="w-full"
                            >
                              <SelectValue
                                placeholder={
                                  customModelsLoading
                                    ? '正在获取…'
                                    : customModels.length
                                      ? '选择模型'
                                      : '暂无模型，请先获取'
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {customModels.map(model => (
                                <SelectItem
                                  key={model}
                                  value={model}
                                >
                                  {model}
                                  {customVisionCapabilitiesKnown
                                    ? customVisionModels.includes(model)
                                      ? ' · Vision'
                                      : ' · Text only'
                                    : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {customVisionCapabilitiesKnown &&
                            customModel &&
                            !customVisionModels.includes(customModel) && (
                              <p className="text-destructive text-xs">
                                当前模型不支持图片输入，请选择标记为 Vision 的模型。
                              </p>
                            )}
                        </div>
                      </>
                    )}
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => {
                        commandsManager?.run('testVlm', {
                          vlmProvider,
                          instruction: medgemmaInstruction,
                          query: medgemmaQuery,
                          startSlice: medgemmaStartSlice,
                          endSlice: medgemmaEndSlice,
                          medgemmaVariant,
                          medgemmaThinkingEnabled,
                          geminiModel: geminiModel?.trim() || undefined,
                          geminiThinkingLevel,
                          openaiModel: openaiModel?.trim() || undefined,
                          openaiReasoningEffort: openaiReasoningEffort?.trim() || undefined,
                          claudeModel: claudeModel?.trim() || undefined,
                          claudeThinkingEffort,
                          kimiModel: kimiModel?.trim() || undefined,
                          kimiReasoningEnabled,
                          qwenModel: qwenModel?.trim() || undefined,
                          qwenThinkingEnabled,
                          gemmaModel: gemmaModel?.trim() || undefined,
                          gemmaThinkingEnabled,
                          vllmBaseUrl: vllmBaseUrl?.trim() || undefined,
                          vllmFamily,
                          vllmThinkingLevel,
                          customBaseUrl: customBaseUrl?.trim() || undefined,
                          customApiKey: customApiKey?.trim() || undefined,
                          customEndpointType,
                          customModel: customModel?.trim() || undefined,
                          customMasStrategy,
                        });
                      }}
                      disabled={
                        !medgemmaQuery ||
                        medgemmaQuery.trim() === '' ||
                        (vlmProvider === 'custom' && !customModel?.trim())
                      }
                      className="w-full"
                    >
                      运行
                    </Button>
                    {vlmProvider === 'custom' && !customModel?.trim() && (
                      <p className="text-destructive text-xs">
                        请先点击「获取模型列表」并选择一个模型后再运行。
                      </p>
                    )}
                    {medgemmaResult && (
                      <div className="mt-2 flex flex-col gap-2">
                        <Label className="text-sm font-semibold">结果：</Label>
                        <div className="bg-accent/40 border-border max-h-[300px] overflow-y-auto rounded-md border p-3">
                          <pre className="text-foreground whitespace-pre-wrap break-words text-sm">
                            {medgemmaResult}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {activeToolOptions && (
            <div className="bg-card border-border mt-2 border-t px-3 py-2">
              <span className="text-muted-foreground mb-2 block text-[11px] font-medium tracking-wider">
                工具参数
              </span>
              <ToolSettings options={activeToolOptions} />
            </div>
          )}
        </PanelSection.Content>
      )}
    </PanelSection>
  );
}
