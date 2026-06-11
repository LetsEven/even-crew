import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  RefreshCw,
  ChevronLeft,
  ChevronDown,
  Check,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { getOrderHistory, getAvailableMonths } from "../services/api";
import type { Branch } from "../services/api";
import type { Order, OrderType } from "../types";
import { formatFolio } from "../utils/folio";

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  tap: "Tap Order & Pay",
  pick_and_go: "Pick & Go",
  room: "Room Service",
  tap_pay: "Tap & Pay",
  flex_bill: "Flex Bill",
};

const ORDER_TYPE_COLORS: Record<OrderType, string> = {
  tap: "bg-blue-500/20 text-blue-300",
  pick_and_go: "bg-orange-500/20 text-orange-300",
  room: "bg-pink-500/20 text-pink-300",
  tap_pay: "bg-cyan-500/20 text-cyan-300",
  flex_bill: "bg-purple-500/20 text-purple-300",
};

const MONTH_NAMES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function monthLabel(ym: string) {
  const [year, month] = ym.split("-");
  return `${MONTH_NAMES_ES[parseInt(month) - 1]} ${year}`;
}

type Filter = "today" | "last7" | "last30" | string;

function getDateRange(filter: Filter): { since: string; until: string } {
  const now = new Date();
  if (filter === "today") {
    const since = new Date(now);
    since.setHours(0, 0, 0, 0);
    const until = new Date(now);
    until.setHours(23, 59, 59, 999);
    return { since: since.toISOString(), until: until.toISOString() };
  }
  if (filter === "last7") {
    const since = new Date(now);
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);
    return { since: since.toISOString(), until: now.toISOString() };
  }
  if (filter === "last30") {
    const since = new Date(now);
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
    return { since: since.toISOString(), until: now.toISOString() };
  }
  // month: "2026-05"
  const [year, month] = filter.split("-").map(Number);
  const since = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const until = new Date(year, month, 0, 23, 59, 59, 999);
  return { since: since.toISOString(), until: until.toISOString() };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  onBack: () => void;
  onOpenPrinters: () => void;
  branches: Branch[];
  branchesLoading: boolean;
  branchId: string | null;
  onBranchChange: (id: string) => void;
}

export default function Historial({
  onBack,
  branches,
  branchesLoading,
  branchId,
  onBranchChange,
}: Props) {
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<Filter>("today");
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const branchRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(
    async (showSpinner = true, filter: Filter = selectedFilter) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const { since, until } = getDateRange(filter);
        const data = await getOrderHistory(token, branchId, since, until);
        setOrders(data);
      } catch (e: any) {
        setError(e.message ?? "Error al cargar historial");
      } finally {
        setLoading(false);
      }
    },
    [getToken, branchId, selectedFilter],
  );

  const fetchAvailableMonths = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const months = await getAvailableMonths(token, branchId);
      setAvailableMonths(months);
    } catch {
      setAvailableMonths([]);
    }
  }, [getToken, branchId]);

  useEffect(() => {
    if (branchId) {
      fetchAvailableMonths();
    }
  }, [fetchAvailableMonths, branchId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    };
    if (branchOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [branchOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    if (filterOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  const handleFilterChange = (f: Filter) => {
    setSelectedFilter(f);
    fetchHistory(true, f);
  };

  const FIXED_FILTERS: { id: Filter; label: string }[] = [
    { id: "today", label: "Hoy" },
    { id: "last7", label: "7 días" },
    { id: "last30", label: "30 días" },
  ];

  const allFilters = [
    ...FIXED_FILTERS,
    ...availableMonths.map((ym) => ({ id: ym, label: monthLabel(ym) })),
  ];

  const selectedLabel =
    allFilters.find((f) => f.id === selectedFilter)?.label ?? "Hoy";

  return (
    <div
      className="relative min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(to bottom right, #0a8b9b, #0d3d43)",
      }}
    >
      {/* Header */}
      <header className="px-5 pt-5 pb-2 flex items-center justify-between relative">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <img
          src="/logo-short-green.webp"
          className="absolute left-1/2 -translate-x-1/2 w-8 h-8"
          alt="Even"
        />

        <div className="flex items-center gap-1">
          <button
            onClick={() => fetchHistory(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </header>

      {/* Título y selector de sucursal */}
      <div className="flex flex-col items-center pb-3 gap-1">
        <h1 className="text-white font-semibold text-xl">Historial</h1>
        {!branchesLoading && branches.length > 0 && (
          <div className="relative" ref={branchRef}>
            <button
              onClick={() => setBranchOpen((v) => !v)}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/80 text-sm rounded-full px-4 py-1.5 border border-white/10 transition-colors cursor-pointer"
            >
              <span>
                {branches.find((b) => b.id === branchId)?.name ??
                  "Seleccionar sucursal"}
              </span>
              {branches.length > 1 && (
                <ChevronDown
                  className={`w-3.5 h-3.5 text-white/40 transition-transform ${branchOpen ? "rotate-180" : ""}`}
                />
              )}
            </button>
            {branchOpen && branches.length > 1 && (
              <ul className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 min-w-full w-max bg-[#0a3238] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
                {branches.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => {
                        onBranchChange(b.id);
                        setBranchOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <span>{b.name}</span>
                      {b.id === branchId && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Filter dropdown */}
        {branchId && (
          <div className="relative pt-2" ref={filterRef}>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/80 text-sm rounded-full px-4 py-1.5 border border-white/10 transition-colors cursor-pointer"
            >
              <span>{selectedLabel}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-white/40 transition-transform ${filterOpen ? "rotate-180" : ""}`}
              />
            </button>
            {filterOpen && (
              <ul className="absolute z-50 top-full mt-1 left-1/2 -translate-x-1/2 min-w-full w-max bg-[#0a3238] border border-white/10 rounded-2xl overflow-hidden shadow-xl max-h-64 overflow-y-auto">
                {allFilters.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => {
                        handleFilterChange(f.id);
                        setFilterOpen(false);
                      }}
                      className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <span>{f.label}</span>
                      {f.id === selectedFilter && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loading && !error && branchId && (
          <p className="text-white/50 text-sm pt-1">
            {orders.length} orden(es)
          </p>
        )}
      </div>

      {/* Panel de contenido */}
      <div
        className="flex-1 rounded-t-4xl px-5 pt-6 pb-6 flex flex-col min-h-0 overflow-hidden"
        style={{
          background: "rgba(10, 50, 56, 0.85)",
          backdropFilter: "blur(10px)",
        }}
      >
        {branchesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin" />
          </div>
        ) : !branchId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/70">
            <p className="font-medium text-white">Selecciona una sucursal</p>
            <p className="text-sm text-center">
              Usa el selector de arriba para ver el historial de la sucursal.
            </p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/70">
            <p className="font-medium text-white">Error al cargar historial</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={() => fetchHistory(true)}
              className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium hover:bg-white/30 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-white/50 text-sm">
              No hay órdenes en este período
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
            {orders.map((order) => {
              const allDelivered =
                order.orderType === "pick_and_go"
                  ? order.cookingStatus === "delivered"
                  : order.dishes.every((d) => d.status === "delivered");
              return (
                <div
                  key={order.id}
                  className="bg-white/5 border border-white/8 rounded-2xl p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${ORDER_TYPE_COLORS[order.orderType]}`}
                      >
                        {ORDER_TYPE_LABELS[order.orderType]}
                      </span>
                      <span className="text-white font-semibold text-base">
                        {order.identifier}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {allDelivered ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Completado
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
                          <Clock className="w-3.5 h-3.5" />
                          Pendiente
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-white/40">
                    <span>{formatDateTime(order.createdAt)}</span>
                    {order.folio != null && (
                      <span className="text-white/25 ml-1 font-mono text-xs bg-white/10 px-2 py-0.5 rounded-full">
                        #{formatFolio(order.folio)}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {order.dishes.map((dish) => (
                      <div
                        key={dish.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-white/80 text-sm">
                          <span className="text-white/40 mr-1">
                            {dish.quantity}×
                          </span>
                          {dish.item}
                          {dish.orderedBy && (
                            <span className="text-white/30 ml-1">
                              · {dish.orderedBy}
                            </span>
                          )}
                          {dish.userFolio && (
                            <span className="text-white/25 ml-1 font-mono text-xs bg-white/10 px-2 py-0.5 rounded-full">
                              #{formatFolio(dish.userFolio)}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {order.orderType === "flex_bill" &&
                    order.totalAmount != null && (
                      <div className="flex items-center gap-4 pt-2 border-t border-white/8 text-xs">
                        <span className="text-white/50">
                          Total{" "}
                          <span className="text-white font-medium">
                            ${order.totalAmount.toFixed(2)}
                          </span>
                        </span>
                        <span className="text-white/50">
                          Pagado{" "}
                          <span className="text-emerald-400 font-medium">
                            ${(order.paidAmount ?? 0).toFixed(2)}
                          </span>
                        </span>
                        {(order.remainingAmount ?? 0) > 0 && (
                          <span className="text-white/50">
                            Restante{" "}
                            <span className="text-amber-400 font-medium">
                              ${order.remainingAmount!.toFixed(2)}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
