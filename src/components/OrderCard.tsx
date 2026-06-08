import { useState, Fragment } from "react";
import { Banknote } from "lucide-react";
import type { Order, DishStatus, CookingStatus } from "../types";
import type { Branch } from "../services/api";
import DishItem from "./DishItem";
import CashPaymentModal from "./CashPaymentModal";
import { formatFolio } from "../utils/folio";

const ORDER_TYPE_LABELS: Record<string, string> = {
  tap: "Tap Order & Pay",
  pick_and_go: "Pick & Go",
  room: "Room Service",
  tap_pay: "Tap & Pay",
  flex_bill: "Flex Bill",
};

const ORDER_TYPE_COLORS: Record<string, string> = {
  tap: "bg-blue-500/20 text-blue-300",
  pick_and_go: "bg-orange-500/20 text-orange-300",
  room: "bg-pink-500/20 text-pink-300",
  tap_pay: "bg-cyan-500/20 text-cyan-300",
  flex_bill: "bg-purple-500/20 text-purple-300",
};

const COOKING_STATUS_LABELS: Record<CookingStatus, string> = {
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
};

const COOKING_STATUS_BADGE: Record<CookingStatus, string> = {
  preparing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ready: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  delivered: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const COOKING_BUTTON_ACTIVE: Record<CookingStatus, string> = {
  preparing: "bg-amber-500 text-white border-amber-500",
  ready: "bg-blue-500 text-white border-blue-500",
  delivered: "bg-emerald-500 text-white border-emerald-500",
};

const COOKING_STATUSES: CookingStatus[] = ["preparing", "ready", "delivered"];

interface OrderCardProps {
  order: Order;
  onDishStatusChange: (dishId: string, status: DishStatus) => void;
  onOrderCookingStatusChange?: (orderId: string, status: CookingStatus) => void;
  currentBranch?: Branch | null;
  onPaymentRegistered?: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeOnly(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function paymentTypeLabel(cardType: string | null): string {
  if (cardType === "cash") return "Efectivo";
  if (cardType === "terminal") return "Terminal";
  if (
    cardType === "debit" ||
    cardType === "credit" ||
    cardType === "digital_wallet"
  )
    return "Digital";
  return "—";
}

export default function OrderCard({
  order,
  onDishStatusChange,
  onOrderCookingStatusChange,
  currentBranch,
  onPaymentRegistered,
}: OrderCardProps) {
  const isPickAndGo = order.orderType === "pick_and_go";
  const delivered = order.dishes.filter((d) => d.status === "delivered").length;
  const total = order.dishes.length;
  const currentCookingStatus = order.cookingStatus ?? "preparing";
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const canRegisterPayment =
    order.orderType === "flex_bill" &&
    (order.remainingAmount ?? 0) > 0 &&
    currentBranch != null;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "rgba(255,255,255,0.07)" }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span
            className={`text-xs px-3 py-1 rounded-full font-medium ${ORDER_TYPE_COLORS[order.orderType] ?? "bg-white/10 text-white/70"}`}
          >
            {ORDER_TYPE_LABELS[order.orderType] ?? order.orderType}
          </span>
          <span className="text-xs text-white/40">
            {formatTime(order.createdAt)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
            <h2 className="text-xl font-bold text-white">{order.identifier}</h2>
            {order.customerName && (
              <span className="text-base text-white/80">
                — {order.customerName}
              </span>
            )}
          </div>
          {order.folio != null && order.folio !== "" && (
            <span className="shrink-0 text-sm font-mono font-semibold px-2 py-0.5 rounded-full bg-white/10 text-white/60">
              #{formatFolio(order.folio)}
            </span>
          )}
        </div>
        {isPickAndGo ? (
          <span
            className={`mt-0.5 text-xs px-2.5 py-1 rounded-full border font-medium ${COOKING_STATUS_BADGE[currentCookingStatus]}`}
          >
            {COOKING_STATUS_LABELS[currentCookingStatus]}
          </span>
        ) : (
          <p className="text-sm text-white/50 mt-0.5">
            {delivered}/{total} entregados
          </p>
        )}
        {order.orderNotes && (
          <p className="text-sm text-white/80 mt-1.5">
            Comentarios: {order.orderNotes}
          </p>
        )}
      </div>

      {/* Dishes */}
      <div className="px-5 py-4 flex flex-col gap-4">
        {order.dishes.map((dish) => (
          <DishItem
            key={dish.id}
            dish={dish}
            onStatusChange={onDishStatusChange}
            hideStatusButtons={isPickAndGo}
          />
        ))}
      </div>

      {/* Order-level cooking status buttons for Pick & Go */}
      {isPickAndGo && (
        <div className="px-5 pb-5 pt-2 border-t border-white/10">
          <div className="flex gap-2">
            {COOKING_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onOrderCookingStatusChange?.(order.id, s)}
                disabled={currentCookingStatus === s}
                className={`flex-1 py-1 text-sm rounded-full font-medium border transition-all active:scale-95 ${
                  currentCookingStatus === s
                    ? COOKING_BUTTON_ACTIVE[s]
                    : "bg-transparent text-white/50 border-white/20 hover:border-white/40"
                }`}
              >
                {COOKING_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pagos flex_bill */}
      {order.orderType === "flex_bill" &&
        (order.totalAmount != null ||
          order.paidAmount != null ||
          (order.payments?.length ?? 0) > 0 ||
          canRegisterPayment) && (
          <div className="px-5 pb-5 pt-2 border-t border-white/10 flex flex-col gap-2">
            {order.orderType === "flex_bill" &&
              (order.totalAmount != null || order.paidAmount != null) && (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center flex-1">
                    <span className="text-xs text-white/40">Total</span>
                    <span className="text-sm font-semibold text-white">
                      ${(order.totalAmount ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                    <span className="text-xs text-white/40">Pagado</span>
                    <span className="text-sm font-semibold text-emerald-400">
                      ${(order.paidAmount ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex flex-col items-center flex-1">
                    <span className="text-xs text-white/40">Restante</span>
                    <span
                      className={`text-sm font-semibold ${
                        (order.remainingAmount ?? 0) > 0
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}
                    >
                      ${(order.remainingAmount ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            {(order.payments?.length ?? 0) > 0 && (
              <div className="border-t border-white/10 pt-2 grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 items-center">
                <span className="text-[10px] uppercase text-white/30 font-medium pb-1">
                  Hora
                </span>
                <span className="text-[10px] uppercase text-white/30 font-medium pb-1">
                  Quién
                </span>
                <span className="text-[10px] uppercase text-white/30 font-medium pb-1">
                  Tipo
                </span>
                <span className="text-[10px] uppercase text-white/30 font-medium text-right pb-1">
                  Monto
                </span>
                <span className="text-[10px] uppercase text-white/30 font-medium text-right pb-1">
                  Prop
                </span>
                {order.payments!.map((p) => (
                  <Fragment key={p.id}>
                    <span className="text-white/40 text-xs py-1.5 border-t border-white/10">
                      {formatTimeOnly(p.createdAt)}
                    </span>
                    <span className="text-white/60 text-xs truncate py-1.5 border-t border-white/10">
                      {p.guestName ?? "—"}
                    </span>
                    <span className="text-white/50 text-xs py-1.5 border-t border-white/10">
                      {paymentTypeLabel(p.cardType)}
                    </span>
                    <span className="text-emerald-400 text-xs font-medium text-right py-1.5 border-t border-white/10">
                      ${p.baseAmount.toFixed(2)}
                    </span>
                    <span className="text-white/30 text-xs text-right py-1.5 border-t border-white/10">
                      {p.tipAmount > 0 ? `+$${p.tipAmount.toFixed(2)}` : "—"}
                    </span>
                  </Fragment>
                ))}
              </div>
            )}

            {canRegisterPayment && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="mt-1 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-medium hover:bg-emerald-500/25 transition-colors active:scale-[0.98]"
              >
                <Banknote className="w-4 h-4" />
                Registrar pago
              </button>
            )}
          </div>
        )}

      {showPaymentModal && currentBranch && (
        <CashPaymentModal
          order={order}
          branch={currentBranch}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setShowPaymentModal(false);
            onPaymentRegistered?.();
          }}
        />
      )}
    </div>
  );
}
