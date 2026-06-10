import { useCallback, useEffect, useRef, useState } from "react";
import { useClerk, useAuth } from "@clerk/clerk-react";
import {
  LogOut,
  PrinterIcon,
  RefreshCw,
  ChevronDown,
  Check,
  Menu,
  History,
  LayoutGrid,
} from "lucide-react";
import OrderCarousel from "../components/OrderCarousel";
import { deleteFcmToken, syncTapPayOrderFromPOS } from "../services/api";
import type { Branch } from "../services/api";
import type { DishStatus, CookingStatus, Order } from "../types";
import { formatFolio } from "../utils/folio";

async function showWindow() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_main_window");
  } catch {}
}

async function syncHasOrders(hasOrders: boolean) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_has_orders", { hasOrders });
  } catch {}
}

async function registerFcmToken(authToken: string) {
  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 3000;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const token = await invoke<string | null>("get_fcm_token");
      if (token) {
        const { saveFcmToken } = await import("../services/api");
        await saveFcmToken(authToken, token, "android");
        return;
      }
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

async function requestNotificationPermission() {
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    const granted = await isPermissionGranted();
    if (!granted) await requestPermission();
  } catch {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }
}

interface Props {
  onOpenPrinters: () => void;
  onOpenHistorial: () => void;
  onOpenMesas: () => void;
  orders: Order[];
  loading: boolean;
  error: string | null;
  fetchOrders: (showSpinner?: boolean) => Promise<unknown>;
  updateDish: (
    orderId: string,
    orderType: string,
    dishId: string,
    status: DishStatus,
  ) => Promise<void>;
  updateOrderCookingStatus: (
    orderId: string,
    status: CookingStatus,
  ) => Promise<void>;
  newOrderNotifications: {
    id: string;
    folio: string | number | null;
    customerName: string | null;
    identifier: string;
    orderedBy: string | null;
  }[];
  onDismissAlert: (id: string) => void;
  branches: Branch[];
  branchesLoading: boolean;
  branchId: string | null;
  onBranchChange: (id: string) => void;
}

export default function Kitchen({
  onOpenPrinters,
  onOpenHistorial,
  onOpenMesas,
  orders,
  loading,
  error,
  fetchOrders,
  updateDish,
  updateOrderCookingStatus,
  newOrderNotifications,
  onDismissAlert,
  branches,
  branchesLoading,
  branchId,
  onBranchChange,
}: Props) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const branchRef = useRef<HTMLDivElement>(null);
  const { signOut } = useClerk();
  const { getToken } = useAuth();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    };
    if (branchOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [branchOpen]);

  const handleSignOut = useCallback(async () => {
    try {
      const token = await getToken();
      const fcmToken = await (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          return await invoke<string | null>("get_fcm_token");
        } catch {
          return null;
        }
      })();
      if (token && fcmToken) await deleteFcmToken(token, fcmToken);
    } catch {}
    signOut();
  }, [getToken, signOut]);

  useEffect(() => {
    requestNotificationPermission();
    getToken().then((t) => {
      if (t) registerFcmToken(t);
    });
  }, [getToken]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/plugin-notification")
      .then(({ onAction }) => onAction(() => showWindow()))
      .then((listener) => {
        unlisten = () => listener.unregister();
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    syncHasOrders(orders.length > 0);
  }, [orders.length]);

  // Refetch al volver al frente
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchOrders();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchOrders]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) fetchOrders();
        }),
      )
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [fetchOrders]);

  const handleActualizar = useCallback(async () => {
    const tapPayOrders = orders.filter((o) => o.orderType === "tap_pay");
    if (tapPayOrders.length > 0) {
      const token = await getToken();
      if (token) {
        await Promise.allSettled(
          tapPayOrders.map((o) =>
            syncTapPayOrderFromPOS(o.id, token).catch(() => {}),
          ),
        );
      }
    }
    fetchOrders(true);
  }, [orders, getToken, fetchOrders]);

  return (
    <div
      className="relative min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(to bottom right, #0a8b9b, #0d3d43)",
      }}
    >
      {/* Notificaciones de nueva orden — apiladas como deck */}
      {newOrderNotifications.length > 0 && (
        <div
          className="fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          style={{ width: "300px" }}
        >
          {newOrderNotifications.map((n, depth) => {
            if (depth > 2) return null;
            const folioPart =
              n.folio != null ? `#${formatFolio(n.folio)}` : null;
            const subtitle = [folioPart, n.identifier || null]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={n.id}
                className="absolute inset-x-0 top-0 bg-[#173E44]/90 backdrop-blur-xl border border-white/15 shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] rounded-2xl px-4 py-3 flex items-center gap-3"
                style={{
                  zIndex: 50 - depth,
                  transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`,
                  transformOrigin: "top center",
                  transition: "transform 0.3s ease",
                  pointerEvents: depth === 0 ? "auto" : "none",
                }}
              >
                {/* Ping dot — contenedor explícito para centrar la animación */}
                <div className="relative shrink-0 w-3 h-3 flex items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 animate-ping" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm leading-tight">
                    Nueva orden recibida
                  </p>
                  {subtitle && (
                    <p className="text-white/60 text-xs mt-0.5 leading-tight">
                      {subtitle}
                    </p>
                  )}
                </div>
                <div className="w-px self-stretch bg-white/15 mx-1 shrink-0" />
                <button
                  onClick={() => onDismissAlert(n.id)}
                  className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-white hover:bg-white/90 transition-colors cursor-pointer shadow-sm"
                  title="Dismiss"
                >
                  <Check
                    className="w-3.5 h-3.5 text-gray-800"
                    strokeWidth={2.5}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <header className="px-5 pt-5 pb-2 flex items-center justify-between relative">
        {/* Hamburger menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition- cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>
          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-[#0a3238] border border-white/10 rounded-2xl overflow-hidden shadow-xl z-50">
              <button
                onClick={() => {
                  onOpenPrinters();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <PrinterIcon className="w-4 h-4 shrink-0" />
                Impresoras
              </button>

              <button
                onClick={() => {
                  onOpenMesas();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <LayoutGrid className="w-4 h-4 shrink-0" />
                Mesas
              </button>

              <button
                onClick={() => {
                  onOpenHistorial();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <History className="w-4 h-4 shrink-0" />
                Historial
              </button>

              <div className="h-px bg-white/10 mx-3" />
              <button
                onClick={() => {
                  handleSignOut();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-rose-400 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>

        {/* Logo centrado */}
        <img
          src="/logo-short-green.webp"
          className="absolute left-1/2 -translate-x-1/2 w-8 h-8"
          alt="Even"
        />

        {/* Actualizar */}
        <button
          onClick={handleActualizar}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </header>

      {/* Logo central */}
      <div className="flex flex-col items-center pb-6 gap-1">
        <h1 className="text-white font-semibold text-xl">Even Crew</h1>
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
        {(() => {
          const currentBranch = branches.find((b) => b.id === branchId);
          const max = currentBranch?.max_pending_orders ?? null;
          const count = orders.length;
          const atLimit = max !== null && count >= max;
          return (
            <p
              className={`text-sm ${atLimit ? "text-amber-400 font-semibold" : "text-white/50"}`}
            >
              {max !== null
                ? `${count} / ${max} orden(es) activas${atLimit ? " ⚠️" : ""}`
                : `${count} orden(es) pendiente(s)`}
            </p>
          );
        })()}
      </div>

      {/* Panel oscuro inferior */}
      <div
        className="flex-1 rounded-t-4xl px-5 pt-6 pb-6 flex flex-col min-h-0"
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
              Usa el selector de arriba para elegir la sucursal que deseas
              monitorear.
            </p>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/70">
            <p className="font-medium text-white">Error al cargar órdenes</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={() => fetchOrders(true)}
              className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium hover:bg-white/30 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <OrderCarousel
            orders={orders}
            onDishStatusChange={updateDish}
            onOrderCookingStatusChange={updateOrderCookingStatus}
            currentBranch={branches.find((b) => b.id === branchId) ?? null}
            onOrdersRefresh={() => fetchOrders()}
          />
        )}
      </div>
    </div>
  );
}
