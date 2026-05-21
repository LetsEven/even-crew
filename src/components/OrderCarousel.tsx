import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Order, DishStatus, CookingStatus } from "../types";
import type { Branch } from "../services/api";
import OrderCard from "./OrderCard";

interface OrderCarouselProps {
  orders: Order[];
  onDishStatusChange: (
    orderId: string,
    orderType: string,
    dishId: string,
    status: DishStatus,
  ) => void;
  onOrderCookingStatusChange: (orderId: string, status: CookingStatus) => void;
  currentBranch?: Branch | null;
  onOrdersRefresh?: () => void;
}

export default function OrderCarousel({
  orders,
  onDishStatusChange,
  onOrderCookingStatusChange,
  currentBranch,
  onOrdersRefresh,
}: OrderCarouselProps) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, orders.length - 1));

  if (orders.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="text-5xl">✅</div>
        <p className="text-lg font-medium text-white">Sin órdenes pendientes</p>
        <p className="text-sm text-white/50">
          Todas las órdenes han sido entregadas
        </p>
      </div>
    );
  }

  const order = orders[safeIndex];
  const prev = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => setIndex((i) => Math.min(orders.length - 1, i + 1));

  return (
    <div className="flex flex-col gap-4">
      {/* Navegación */}
      <div className="flex items-center justify-between">
        <button
          onClick={prev}
          disabled={safeIndex === 0}
          className="p-2 rounded-xl bg-white/10 disabled:opacity-20 active:scale-95 transition-all"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white/70">
            {safeIndex + 1} / {orders.length}
          </span>
          <div className="flex gap-1.5">
            {orders.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === safeIndex ? "bg-white w-5" : "bg-white/30 w-2"
                }`}
              />
            ))}
          </div>
        </div>

        <button
          onClick={next}
          disabled={safeIndex === orders.length - 1}
          className="p-2 rounded-xl bg-white/10 disabled:opacity-20 active:scale-95 transition-all"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Orden actual */}
      <OrderCard
        order={order}
        onDishStatusChange={(dishId, status) =>
          onDishStatusChange(order.id, order.orderType, dishId, status)
        }
        onOrderCookingStatusChange={onOrderCookingStatusChange}
        currentBranch={currentBranch}
        onPaymentRegistered={onOrdersRefresh}
      />
    </div>
  );
}
