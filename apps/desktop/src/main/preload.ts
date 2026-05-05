import { contextBridge, ipcRenderer } from "electron";
import type { BuilderRequest } from "@buildbotprime/core";
import type { ModelProviderId } from "@buildbotprime/model-providers";
import type { TwinMindEvent } from "@buildbotprime/twin-mind";
import type {
  BuildBotPrimeApi,
  TwinChatRequest,
  TwinMindStartRequest
} from "../shared/ipc.js";

const IPC_CHANNELS = {
  getBootstrap: "buildbotprime:get-bootstrap",
  startBuild: "buildbotprime:start-build",
  selectProjectFolder: "buildbotprime:select-project-folder",
  selectIntakeDocuments: "buildbotprime:select-intake-documents",
  saveProviderSettings: "buildbotprime:save-provider-settings",
  clearProviderSettings: "buildbotprime:clear-provider-settings",
  setActiveProvider: "buildbotprime:set-active-provider",
  toggleDevTools: "buildbotprime:toggle-devtools",
  twinMindStart: "buildbotprime:twin-mind-start",
  twinMindStop: "buildbotprime:twin-mind-stop",
  twinMindPickVariant: "buildbotprime:twin-mind-pick-variant",
  twinMindApprove: "buildbotprime:twin-mind-approve",
  twinMindSendMessage: "buildbotprime:twin-mind-send-message",
  twinMindGetSnapshot: "buildbotprime:twin-mind-get-snapshot",
  twinMindEvent: "buildbotprime:twin-mind-event",
  twinMindChat: "buildbotprime:twin-mind-chat"
} as const;

const api: BuildBotPrimeApi = {
  getBootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.getBootstrap),
  startBuild: (request: BuilderRequest) => ipcRenderer.invoke(IPC_CHANNELS.startBuild, request),
  selectProjectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectFolder),
  selectIntakeDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.selectIntakeDocuments),
  saveProviderSettings: (providerId: ModelProviderId, values: Record<string, string>) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveProviderSettings, providerId, values),
  clearProviderSettings: (providerId: ModelProviderId) =>
    ipcRenderer.invoke(IPC_CHANNELS.clearProviderSettings, providerId),
  setActiveProvider: (providerId: ModelProviderId | "all") =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveProvider, providerId),
  toggleDevTools: () => ipcRenderer.invoke(IPC_CHANNELS.toggleDevTools),

  twinMindStart: (request: TwinMindStartRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindStart, request),
  twinMindStop: (sessionId: string, reason?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindStop, sessionId, reason),
  twinMindPickVariant: (sessionId: string, variantId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindPickVariant, sessionId, variantId),
  twinMindApprove: (sessionId: string, approvalId: string, approve: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindApprove, sessionId, approvalId, approve),
  twinMindSendMessage: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindSendMessage, sessionId, text),
  twinMindGetSnapshot: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindGetSnapshot, sessionId),
  twinMindOnEvent: (callback: (event: TwinMindEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: TwinMindEvent): void => {
      callback(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.twinMindEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.twinMindEvent, listener);
    };
  },
  twinMindChat: (request: TwinChatRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.twinMindChat, request)
};

contextBridge.exposeInMainWorld("buildBotPrime", api);
