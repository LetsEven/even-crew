import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { DishStatus, Order } from "../types";
import type { PrintJobData } from "./usePrinting";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CREW_SECRET =
  import.meta.env.VITE_CREW_SOCKET_SECRET || "even-crew-secret";

export interface CrewDevice {
  deviceId: string;
  socketId: string | null;
  connectedAt: string | null;
  online: boolean;
}

interface UseSocketProps {
  branchId: string | null;
  deviceId: string;
  onOrderClosed: (orderId: string) => void;
  onDishStatusChanged: (dishId: string, status: DishStatus) => void;
  onRefetch: () => void;
  onSilentRefetch?: () => void;
  onPrintJob?: (data: PrintJobData) => void;
  onDevicesUpdated?: (
    devices: CrewDevice[],
    masterDeviceId: string | null,
  ) => void;
  onFlexbillOrder?: (data: {
    folio: string | null;
    orderedBy: string | null;
    identifier: string | null;
  }) => void;
}

export function useSocket({
  branchId,
  deviceId,
  onOrderClosed,
  onDishStatusChanged,
  onRefetch,
  onSilentRefetch,
  onPrintJob,
  onDevicesUpdated,
  onFlexbillOrder,
}: UseSocketProps) {
  // Refs para los callbacks — siempre actualizados, sin reconectar el socket
  const onOrderClosedRef = useRef(onOrderClosed);
  const onDishStatusChangedRef = useRef(onDishStatusChanged);
  const onRefetchRef = useRef(onRefetch);
  const onSilentRefetchRef = useRef(onSilentRefetch);
  const onPrintJobRef = useRef(onPrintJob);
  const onDevicesUpdatedRef = useRef(onDevicesUpdated);
  const onFlexbillOrderRef = useRef(onFlexbillOrder);

  useEffect(() => {
    onOrderClosedRef.current = onOrderClosed;
  });
  useEffect(() => {
    onDishStatusChangedRef.current = onDishStatusChanged;
  });
  useEffect(() => {
    onRefetchRef.current = onRefetch;
  });
  useEffect(() => {
    onSilentRefetchRef.current = onSilentRefetch;
  });
  useEffect(() => {
    onPrintJobRef.current = onPrintJob;
  });
  useEffect(() => {
    onDevicesUpdatedRef.current = onDevicesUpdated;
  });
  useEffect(() => {
    onFlexbillOrderRef.current = onFlexbillOrder;
  });

  const socketRef = useRef<Socket | null>(null);

  // El socket se conecta/reconecta cuando cambia branchId
  useEffect(() => {
    console.log(
      `[CREW:SOCKET] Iniciando — branchId=${branchId} deviceId=${deviceId}`,
    );
    if (!branchId) {
      console.warn(
        "[CREW:SOCKET] No branchId configurado, socket no conectado",
      );
      return;
    }

    console.log(`[CREW:SOCKET] Conectando a ${BASE_URL}`);
    const socket = io(BASE_URL, {
      auth: { branchId, secret: CREW_SECRET, clientType: "crew", deviceId },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log(`[CREW:SOCKET] ✅ Conectado — id=${socket.id}`);
    });

    socket.on("room:joined", (data: any) => {
      console.log(
        `[CREW:SOCKET] 🏠 Sala unida — restaurant=${data?.restaurantId} branch=${data?.branchId} master=${data?.masterDeviceId}`,
      );
      if (data?.devices !== undefined) {
        onDevicesUpdatedRef.current?.(
          data.devices,
          data.masterDeviceId ?? null,
        );
      }
    });

    socket.on(
      "crew:devices-updated",
      ({
        devices,
        masterDeviceId,
      }: {
        devices: CrewDevice[];
        masterDeviceId: string | null;
      }) => {
        console.log(
          `[CREW:SOCKET] 👥 Dispositivos actualizados — count=${devices.length} master=${masterDeviceId}`,
        );
        onDevicesUpdatedRef.current?.(devices, masterDeviceId);
      },
    );

    socket.on("dashboard:new-transaction", (_data: unknown) => {
      // Notificación viene de kitchen:notify — aquí solo refrescamos silenciosamente
      onSilentRefetchRef.current?.();
    });

    socket.on(
      "dashboard:order-update",
      (data: { order: Order; action: string }) => {
        if (data.action === "closed") {
          onOrderClosedRef.current(data.order.id);
        } else if (data.action === "updated") {
          if (onSilentRefetchRef.current) {
            onSilentRefetchRef.current();
          } else {
            onRefetchRef.current();
          }
        }
      },
    );

    socket.on(
      "table:dish-status",
      (data: { dishId: string; status: DishStatus }) => {
        onDishStatusChangedRef.current(data.dishId, data.status);
      },
    );

    socket.on(
      "tappay:dish-status-changed",
      (data: { dishId: string; status: DishStatus }) => {
        onDishStatusChangedRef.current(data.dishId, data.status);
      },
    );

    socket.on(
      "kitchen:dish-status-changed",
      (data: { dishId: string; status: DishStatus }) => {
        onDishStatusChangedRef.current(data.dishId, data.status);
      },
    );

    socket.on(
      "kitchen:notify",
      (data: {
        wasFlowHeld?: boolean;
        orderType?: string;
        folio?: string | null;
        orderedBy?: string | null;
        identifier?: string | null;
      }) => {
        console.log(
          `[CREW:SOCKET] 🔔 kitchen:notify — wasFlowHeld=${data?.wasFlowHeld} orderType=${data?.orderType} folio=${data?.folio}`,
        );
        onRefetchRef.current();
        // For Flexbill: fire a direct per-user_order notification
        if (data?.orderType === "flex_bill" && data?.folio) {
          onFlexbillOrderRef.current?.({
            folio: data.folio,
            orderedBy: data.orderedBy ?? null,
            identifier: data.identifier ?? null,
          });
        }
      },
    );

    socket.on("kitchen:print_job", async (data: PrintJobData) => {
      console.log(
        `[CREW:SOCKET] 🖨️ kitchen:print_job recibido — branchId=${data.branchId} identifier=${data.orderInfo?.identifier} items=${data.items?.length} jobId=${data.jobId}`,
      );
      try {
        await onPrintJobRef.current?.(data);
        if (data.jobId) {
          socket.emit("print_job_ack", { jobId: data.jobId });
          console.log(
            `[CREW:SOCKET] ✅ print_job_ack enviado — jobId=${data.jobId}`,
          );
        }
      } catch (e) {
        console.error("[CREW:SOCKET] ❌ Error en print_job:", e);
      }
    });

    socket.on("connect_error", (err) => {
      console.error(`[CREW:SOCKET] ❌ Error de conexión: ${err.message}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`[CREW:SOCKET] 🔴 Desconectado — reason=${reason}`);
    });

    socket.on("reconnect", (attempt: number) => {
      console.log(`[CREW:SOCKET] 🔄 Reconectado tras ${attempt} intento(s)`);
    });

    return () => {
      console.log("[CREW:SOCKET] 🧹 Cleanup — desconectando socket");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [branchId, deviceId]); // reconecta si cambia la sucursal

  const setMaster = useCallback((targetDeviceId: string) => {
    socketRef.current?.emit("crew:set-master", { deviceId: targetDeviceId });
  }, []);

  return { setMaster };
}
