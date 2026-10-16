import { useSyncExternalStore } from "react";
import type { ConnectionInfo, Connections } from "tauri-plugin-mihomo-api";

import { ManagedMihomoWebSocket } from "@/services/managedMihomoWs";
import { useConnectionHistoryStore } from "@/stores/connectionHistoryStore";

export type IConnectionsItem = ConnectionInfo & {
  curUpload?: number; // upload speed, calculate at runtime
  curDownload?: number; // download speed, calculate at runtime
};

export type IClosedConnectionItem = IConnectionsItem & {
  closedTime: number;
};

export interface ConnectionMonitorData {
  uploadTotal: number;
  downloadTotal: number;
  activeConnections: IClosedConnectionItem[];
  closedConnections: IClosedConnectionItem[];
}

export const initConnData: ConnectionMonitorData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnections: [],
  closedConnections: [],
};

const MAX_CLOSED_CONNS = 500;
let lastHistoryIngestAt = 0;
let connectionData = initConnData;
let connectionError: unknown = null;
let connectionSocket: ManagedMihomoWebSocket | null = null;
let connectionStarting: Promise<void> | null = null;
let connectionConsumers = 0;
const connectionListeners = new Set<() => void>();

const emitConnectionData = () =>
  connectionListeners.forEach((listener) => {
    listener();
  });

const startConnection = () => {
  if (connectionSocket || connectionStarting) return;
  connectionStarting = ManagedMihomoWebSocket.connectConnections((message) => {
    if (message.type !== "Text") return;
    try {
      connectionData = updateConnections(
        JSON.parse(message.data) as Connections,
        connectionData,
      );
      connectionError = null;
      emitConnectionData();
    } catch (error) {
      connectionError = error;
      emitConnectionData();
    }
  })
    .then((socket) => {
      if (connectionConsumers === 0) return socket.close();
      connectionSocket = socket;
    })
    .catch((error) => {
      connectionError = error;
      emitConnectionData();
    })
    .finally(() => {
      connectionStarting = null;
    });
};

const subscribeConnectionData = (listener: () => void) => {
  connectionListeners.add(listener);
  connectionConsumers += 1;
  startConnection();
  return () => {
    connectionListeners.delete(listener);
    connectionConsumers = Math.max(0, connectionConsumers - 1);
    if (connectionConsumers === 0 && connectionSocket) {
      const socket = connectionSocket;
      connectionSocket = null;
      void socket.close();
    }
  };
};

const updateConnections = (
  data: Connections,
  old: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const now = Date.now();
  if (now - lastHistoryIngestAt >= 1000) {
    lastHistoryIngestAt = now;
    useConnectionHistoryStore.getState().ingest(data.connections ?? []);
  }
  const oldActiveConns = old.activeConnections;
  const oldClosedConns = old.closedConnections;
  const oldActiveConnMap = new Map(oldActiveConns.map((c) => [c.id, c]));

  const activeConnections = (
    (data.connections as IConnectionsItem[]) || []
  ).map((c) => {
    const prev = oldActiveConnMap.get(c.id);
    const curUpload = prev ? c.upload - prev.upload : 0;
    const curDownload = prev ? c.download - prev.download : 0;
    return {
      ...c,
      curUpload,
      curDownload,
      closedTime: 0,
    } as IClosedConnectionItem;
  });

  const activeIds = new Set(activeConnections.map((item) => item.id));
  const closed = oldActiveConns
    .filter((item) => !activeIds.has(item.id))
    .map((item) => ({ ...item, closedTime: Date.now() }));
  const closedConnections = [...oldClosedConns, ...closed].slice(
    -MAX_CLOSED_CONNS,
  );

  return {
    uploadTotal: data.uploadTotal,
    downloadTotal: data.downloadTotal,
    activeConnections,
    closedConnections,
  };
};

export const useConnectionData = () => {
  const data = useSyncExternalStore(
    subscribeConnectionData,
    () => connectionData,
    () => initConnData,
  );
  const response = { data, error: connectionError, isLoading: false };

  const clearClosedConnections = () => {
    connectionData = { ...connectionData, closedConnections: [] };
    emitConnectionData();
  };

  return {
    response,
    clearClosedConnections,
  };
};
