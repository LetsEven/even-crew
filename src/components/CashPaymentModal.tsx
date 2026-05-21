import { useState, useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  X,
  Banknote,
  CreditCard,
  ChevronRight,
  Check,
  Loader2,
} from "lucide-react";
import type {
  Order,
  ManualPaymentMethod,
  ManualPaymentType,
  TableSummary,
  DishOrderCrew,
} from "../types";
import type { Branch } from "../services/api";
import {
  getTableSummary,
  getDishOrders,
  payTableManual,
  payDishOrderManual,
  createManualTransaction,
} from "../services/api";
import { calculateCommissions } from "../utils/commissionCalculator";

interface Props {
  order: Order;
  branch: Branch;
  onClose: () => void;
  onSuccess: () => void;
}

const TIP_OPTIONS = [0, 10, 15, 20] as const;

// Steps: 0=tipo de cobro, 1=propina, 2=método+confirmación
const STEP_LABELS = ["Tipo de cobro", "Propina", "Confirmar"];

function parseTableNumber(identifier: string): number | null {
  const match = identifier
    .replace(/mesa/i, "")
    .trim()
    .match(/^(\d+)/);
  return match ? parseInt(match[1]) : null;
}

export default function CashPaymentModal({
  order,
  branch,
  onClose,
  onSuccess,
}: Props) {
  const { getToken } = useAuth();

  const [step, setStep] = useState(0);

  // Step 0 — tipo de cobro
  const [payType, setPayType] = useState<ManualPaymentType | null>(null);
  const [tableSummary, setTableSummary] = useState<TableSummary | null>(null);
  const [dishOrders, setDishOrders] = useState<DishOrderCrew[]>([]);
  const [selectedDishes, setSelectedDishes] = useState<Set<string>>(new Set());
  const [customAmount, setCustomAmount] = useState("");
  const [equalPeople, setEqualPeople] = useState("2");
  const [loadingData, setLoadingData] = useState(false);

  // Step 1 — propina
  const [tipPct, setTipPct] = useState<number>(0);
  const [customTip, setCustomTip] = useState("");
  const [showCustomTip, setShowCustomTip] = useState(false);

  // Step 2 — método + confirmación
  const [method, setMethod] = useState<ManualPaymentMethod>("cash");
  const [terminalRef, setTerminalRef] = useState("");
  const [cobradoPor, setCobradoPor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const tableNumber = parseTableNumber(order.identifier);

  // Load table summary when step 0 opens
  useEffect(() => {
    if (step === 0 && tableNumber != null && !tableSummary) {
      setLoadingData(true);
      getToken().then(async (token) => {
        if (!token) return;
        try {
          const summary = await getTableSummary(
            String(branch.restaurant_id),
            String(branch.branch_number),
            String(tableNumber),
            token,
          );
          setTableSummary(summary);
        } catch (e: any) {
          console.error("Error loading table data:", e.message);
        } finally {
          setLoadingData(false);
        }
      });
    }
  }, [step]);

  // Load dish orders when select-items is chosen
  useEffect(() => {
    if (
      payType === "select-items" &&
      tableNumber != null &&
      dishOrders.length === 0
    ) {
      setLoadingData(true);
      getToken().then(async (token) => {
        if (!token) return;
        try {
          const dishes = await getDishOrders(
            String(branch.restaurant_id),
            String(branch.branch_number),
            String(tableNumber),
            token,
          );
          setDishOrders(dishes.filter((d) => d.payment_status === "not_paid"));
        } catch (e: any) {
          console.error("Error loading dishes:", e.message);
        } finally {
          setLoadingData(false);
        }
      });
    }
  }, [payType]);

  // Derived amounts
  const remaining =
    tableSummary?.remaining_amount ?? order.remainingAmount ?? 0;

  function getBaseAmount(): number {
    if (payType === "full-bill") return remaining;
    if (payType === "select-items") {
      return dishOrders
        .filter((d) => selectedDishes.has(d.dish_order_id))
        .reduce((sum, d) => sum + d.total_price, 0);
    }
    if (payType === "equal-shares") {
      const n = parseInt(equalPeople) || 2;
      return parseFloat((remaining / n).toFixed(2));
    }
    if (payType === "choose-amount") return parseFloat(customAmount) || 0;
    return 0;
  }

  function getTipAmount(): number {
    const base = getBaseAmount();
    if (showCustomTip) return parseFloat(customTip) || 0;
    return parseFloat(((base * tipPct) / 100).toFixed(2));
  }

  const baseAmount = getBaseAmount();
  const tipAmount = getTipAmount();
  const commissions = calculateCommissions(baseAmount, tipAmount);
  const totalAmount = commissions.totalAmountCharged;

  function canProceedStep0() {
    if (!payType) return false;
    if (payType === "select-items") return selectedDishes.size > 0;
    if (payType === "choose-amount") return parseFloat(customAmount) > 0;
    return baseAmount > 0;
  }

  function canConfirm() {
    if (cobradoPor.trim().length === 0 || totalAmount <= 0) return false;
    if (method === "terminal") return terminalRef.trim().length > 0;
    return true;
  }

  async function handleConfirm() {
    if (!tableSummary || tableNumber == null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("No autenticado");

      const manualRef = method === "terminal" ? terminalRef.trim() : null;

      const txParams = {
        id_table_order: tableSummary.table_order_id,
        restaurant_id: branch.restaurant_id,
        base_amount: baseAmount,
        tip_amount: tipAmount,
        iva_tip: commissions.ivaTip,
        total_amount_charged: totalAmount,
        subtotal_for_commission: commissions.subtotalForCommission,
        even_commission_total: commissions.evenCommissionTotal,
        even_commission_client: commissions.evenCommissionClient,
        even_commission_restaurant: commissions.evenCommissionRestaurant,
        iva_even_client: commissions.ivaEvenClient,
        iva_even_restaurant: commissions.ivaEvenRestaurant,
        even_client_charge: commissions.evenClientCharge,
        even_restaurant_charge: commissions.evenRestaurantCharge,
        even_rate_applied: commissions.even_rate_applied,
        transaction_by: cobradoPor.trim(),
        payment_source: method,
        manual_reference: manualRef,
      };

      if (payType === "select-items") {
        for (const dishId of selectedDishes) {
          await payDishOrderManual(
            dishId,
            cobradoPor.trim(),
            token,
            String(branch.restaurant_id),
            String(branch.branch_number),
            String(tableNumber),
          );
        }
      } else {
        await payTableManual(
          {
            restaurantId: String(branch.restaurant_id),
            branchNumber: String(branch.branch_number),
            tableNumber: String(tableNumber),
            amount: baseAmount,
            guestName: cobradoPor.trim(),
          },
          token,
        );
      }

      await createManualTransaction(txParams, token);

      onSuccess();
    } catch (e: any) {
      setSubmitError(e.message ?? "Error al registrar el pago");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "#0a3238", maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-semibold text-lg">Registrar pago</h2>
            <p className="text-xs text-white/40 mt-0.5">
              {STEP_LABELS[step]} · {step + 1}/{STEP_LABELS.length}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-5 flex flex-col gap-5">
          {/* Mesa info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/50">{order.identifier}</span>
            <span className="text-white/50">
              Restante:{" "}
              <span className="text-amber-400 font-semibold">
                ${(order.remainingAmount ?? 0).toFixed(2)}
              </span>
            </span>
          </div>

          {/* ── Step 0: Tipo de cobro ── */}
          {step === 0 && (
            <div className="flex flex-col gap-4">
              {loadingData && !tableSummary ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {(
                      [
                        {
                          type: "full-bill",
                          label: "Cuenta restante",
                          desc: `$${remaining.toFixed(2)}`,
                        },
                        {
                          type: "select-items",
                          label: "Seleccionar platillos",
                          desc: "Elige items específicos",
                        },
                        {
                          type: "equal-shares",
                          label: "Partes iguales",
                          desc: "Dividir entre personas",
                        },
                        {
                          type: "choose-amount",
                          label: "Elegir monto",
                          desc: "Monto libre",
                        },
                      ] as {
                        type: ManualPaymentType;
                        label: string;
                        desc: string;
                      }[]
                    ).map(({ type, label, desc }) => (
                      <button
                        key={type}
                        onClick={() => setPayType(type)}
                        className={`flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all ${
                          payType === type
                            ? "border-emerald-400 bg-emerald-400/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className="text-left">
                          <p
                            className={`text-sm font-medium ${payType === type ? "text-emerald-400" : "text-white"}`}
                          >
                            {label}
                          </p>
                          <p className="text-xs text-white/40 mt-0.5">{desc}</p>
                        </div>
                        {payType === type && (
                          <Check className="w-4 h-4 text-emerald-400" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Extra inputs per type */}
                  {payType === "select-items" && (
                    <div className="flex flex-col gap-2">
                      {loadingData ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
                        </div>
                      ) : dishOrders.length === 0 ? (
                        <p className="text-sm text-white/40 text-center py-3">
                          Sin platillos pendientes
                        </p>
                      ) : (
                        dishOrders.map((dish) => (
                          <button
                            key={dish.dish_order_id}
                            onClick={() =>
                              setSelectedDishes((prev) => {
                                const next = new Set(prev);
                                if (next.has(dish.dish_order_id))
                                  next.delete(dish.dish_order_id);
                                else next.add(dish.dish_order_id);
                                return next;
                              })
                            }
                            className={`flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all ${
                              selectedDishes.has(dish.dish_order_id)
                                ? "border-emerald-400 bg-emerald-400/10"
                                : "border-white/10 bg-white/5"
                            }`}
                          >
                            <span className="text-sm text-white">
                              {dish.quantity}x {dish.item}
                            </span>
                            <span className="text-sm text-emerald-400 font-medium">
                              ${dish.total_price.toFixed(2)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {payType === "equal-shares" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-white/50">
                        Número de personas
                      </label>
                      <input
                        type="number"
                        min="2"
                        value={equalPeople}
                        onChange={(e) => setEqualPeople(e.target.value)}
                        className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-400/60"
                      />
                      {parseInt(equalPeople) > 1 && (
                        <p className="text-xs text-white/40">
                          Corresponde $
                          {(remaining / (parseInt(equalPeople) || 2)).toFixed(
                            2,
                          )}{" "}
                          por persona
                        </p>
                      )}
                    </div>
                  )}

                  {payType === "choose-amount" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-white/50">
                        Monto a cobrar
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-emerald-400/60"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 1: Propina ── */}
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 flex-wrap">
                {TIP_OPTIONS.map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      setTipPct(pct);
                      setShowCustomTip(false);
                      setCustomTip("");
                    }}
                    className={`flex-1 min-w-[16 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      !showCustomTip && tipPct === pct
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {pct === 0 ? "Sin propina" : `${pct}%`}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustomTip(true)}
                  className={`flex-1 min-w-16 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    showCustomTip
                      ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                      : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  Otro
                </button>
              </div>

              {showCustomTip && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white/50">
                    Monto de propina
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-emerald-400/60"
                  />
                </div>
              )}

              {/* Desglose */}
              <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Subtotal</span>
                  <span className="text-white">${baseAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Propina</span>
                  <span className="text-white">+${tipAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Comisión Even</span>
                  <span className="text-white">
                    +${commissions.evenClientCharge.toFixed(2)}
                  </span>
                </div>
                <div className="h-px bg-white/10 my-1" />
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-white">Total a cobrar</span>
                  <span className="text-white text-base">
                    ${totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Método + Confirmación ── */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              {/* Total destacado */}
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                <p className="text-xs text-emerald-400/70 mb-0.5">
                  Total a cobrar
                </p>
                <p className="text-2xl font-bold text-emerald-400">
                  ${totalAmount.toFixed(2)}
                </p>
              </div>

              {/* Método */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-white/50">Método de pago</p>
                <div className="flex gap-3">
                  {(["cash", "terminal"] as ManualPaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMethod(m);
                        setTerminalRef("");
                      }}
                      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${
                        method === m
                          ? "border-emerald-400 bg-emerald-400/10 text-emerald-400"
                          : "border-white/10 bg-white/5 text-white/50 hover:bg-white/10"
                      }`}
                    >
                      {m === "cash" ? (
                        <Banknote className="w-6 h-6" />
                      ) : (
                        <CreditCard className="w-6 h-6" />
                      )}
                      <span className="text-sm font-medium">
                        {m === "cash" ? "Efectivo" : "Terminal"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Referencia terminal */}
              {method === "terminal" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-white/50">
                    Número de referencia *
                  </label>
                  <input
                    type="text"
                    value={terminalRef}
                    onChange={(e) => setTerminalRef(e.target.value)}
                    placeholder="Ej. REF-001234"
                    className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-emerald-400/60"
                    autoFocus
                  />
                </div>
              )}

              {/* Cobrado por */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-white/50">Cobrado por</label>
                <input
                  type="text"
                  value={cobradoPor}
                  onChange={(e) => setCobradoPor(e.target.value)}
                  placeholder="Nombre del mesero"
                  className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/30 text-sm focus:outline-none focus:border-emerald-400/60"
                />
              </div>

              {submitError && (
                <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-4 py-3">
                  {submitError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-6 pt-3 border-t border-white/10 flex gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              disabled={submitting}
              className="px-5 py-3 rounded-2xl border border-white/10 text-white/60 text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              Atrás
            </button>
          )}

          {step < 2 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 && !canProceedStep0()}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-400 transition-colors"
            >
              Continuar
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={!canConfirm() || submitting}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-400 transition-colors"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {submitting ? "Registrando..." : "Confirmar pago"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
