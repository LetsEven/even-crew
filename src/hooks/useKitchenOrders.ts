import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import type { Order, DishStatus, CookingStatus } from "../types";
import {
  getActiveOrders,
  updateDishStatus,
  updatePickAndGoOrderCookingStatus,
} from "../services/api";

export function useKitchenOrders(branchId: string | null) {
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  // Inicia en true: siempre hay un fetch inicial. Evita que el efecto de
  // inicialización de prevOrderIdsRef corra con orders=[] antes del primer fetch.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(
    async (showSpinner = false): Promise<Order[] | undefined> => {
      if (showSpinner) setLoading(true);
      try {
        const token = await getToken();
        if (!token) return undefined;
        const data = await getActiveOrders(token, branchId);
        setOrders((prev) => {
          // Merge to preserve dish order: existing dishes keep their position,
          // only status/fields update. New dishes append at the end.
          const prevMap = new Map(prev.map((o) => [o.id, o]));
          return data.map((incoming) => {
            const existing = prevMap.get(incoming.id);
            if (!existing) return incoming;
            const incomingDishMap = new Map(
              incoming.dishes.map((d) => [d.id, d]),
            );
            const existingDishIds = new Set(existing.dishes.map((d) => d.id));
            const merged = [
              // keep existing dishes in order, updating their fields
              ...existing.dishes
                .filter((d) => incomingDishMap.has(d.id))
                .map((d) => ({ ...d, ...incomingDishMap.get(d.id)! })),
              // append any brand-new dishes at the end
              ...incoming.dishes.filter((d) => !existingDishIds.has(d.id)),
            ];
            return { ...incoming, dishes: merged };
          });
        });
        setError(null);
        return data;
      } catch (e: any) {
        setError(e.message);
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [getToken, branchId],
  );

  // Reset state when branch changes so the loader shows immediately
  useEffect(() => {
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setOrders([]);
  }, [branchId]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const updateDish = useCallback(
    async (
      orderId: string,
      orderType: string,
      dishId: string,
      status: DishStatus,
    ) => {
      // Optimistic update
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== orderId) return order;
          return {
            ...order,
            dishes: order.dishes.map((d) =>
              d.id === dishId ? { ...d, status } : d,
            ),
          };
        }),
      );

      try {
        const token = await getToken();
        if (!token) return;
        await updateDishStatus(dishId, orderType, status, token);
      } catch (e) {
        // Revertir en caso de error
        fetchOrders();
      }

      // Si todos los dishes están entregados, remover la orden.
      // Excepción flex_bill: la card se mantiene mientras la mesa no se haya
      // pagado (igual que el filtro del backend), para no parpadear al entregar.
      setOrders((prev) =>
        prev.filter((order) => {
          if (order.id !== orderId) return true;
          const updated = order.dishes.map((d) =>
            d.id === dishId ? { ...d, status } : d,
          );
          const hasUndelivered = updated.some((d) => d.status !== "delivered");
          if (hasUndelivered) return true;
          if (
            order.orderType === "flex_bill" &&
            (order.remainingAmount ?? 0) > 0 &&
            order.status !== "paid"
          ) {
            return true;
          }
          return false;
        }),
      );
    },
    [getToken, fetchOrders],
  );

  const updateOrderCookingStatus = useCallback(
    async (orderId: string, status: CookingStatus) => {
      // Optimistic update
      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, cookingStatus: status } : order,
        ),
      );

      try {
        const token = await getToken();
        if (!token) return;
        await updatePickAndGoOrderCookingStatus(orderId, status, token);
      } catch (e) {
        fetchOrders();
        return;
      }

      // Si el pedido fue entregado, removerlo de la lista
      if (status === "delivered") {
        setOrders((prev) => prev.filter((order) => order.id !== orderId));
      }
    },
    [getToken, fetchOrders],
  );

  // Agregar nueva orden (desde socket)
  const addOrder = useCallback((order: Order) => {
    setOrders((prev) => {
      if (prev.find((o) => o.id === order.id)) return prev;
      return [...prev, order];
    });
  }, []);

  // Remover orden (desde socket - cerrada desde otro lado)
  const removeOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
  }, []);

  // Actualizar status de dish desde socket
  const updateDishFromSocket = useCallback(
    (dishId: string, status: DishStatus) => {
      setOrders((prev) =>
        prev
          .map((order) => ({
            ...order,
            dishes: order.dishes.map((d) =>
              d.id === dishId ? { ...d, status } : d,
            ),
          }))
          .filter((order) => {
            if (order.dishes.some((d) => d.status !== "delivered")) return true;
            // flex_bill: conservar mientras la mesa no se haya pagado
            if (
              order.orderType === "flex_bill" &&
              (order.remainingAmount ?? 0) > 0 &&
              order.status !== "paid"
            ) {
              return true;
            }
            return false;
          }),
      );
    },
    [],
  );

  return {
    orders,
    loading,
    error,
    fetchOrders,
    updateDish,
    updateOrderCookingStatus,
    addOrder,
    removeOrder,
    updateDishFromSocket,
  };
}
