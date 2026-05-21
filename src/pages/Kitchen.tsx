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
} from "lucide-react";
import OrderCarousel from "../components/OrderCarousel";
import { deleteFcmToken } from "../services/api";
import type { Branch } from "../services/api";
import type { DishStatus, CookingStatus, Order } from "../types";

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
  orders: Order[];
  loading: boolean;
  error: string | null;
  fetchOrders: (showSpinner?: boolean) => Promise<void>;
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
  newOrderAlert: boolean;
  branches: Branch[];
  branchesLoading: boolean;
  branchId: string | null;
  onBranchChange: (id: string) => void;
}

export default function Kitchen({
  onOpenPrinters,
  onOpenHistorial,
  orders,
  loading,
  error,
  fetchOrders,
  updateDish,
  updateOrderCookingStatus,
  newOrderAlert,
  branches,
  branchesLoading,
  branchId,
  onBranchChange,
}: Props) {
  const [branchOpen, setBranchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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

  return (
    <div
      className="relative min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(to bottom right, #0a8b9b, #0d3d43)",
      }}
    >
      {/* Banner nueva orden */}
      {newOrderAlert && (
        <div
          className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-emerald-500 text-white px-5 py-2.5 rounded-full font-semibold text-sm shadow-lg pointer-events-none"
          style={{ animation: "fadeSlideDown 0.25s ease" }}
        >
          <span className="w-2 h-2 rounded-full bg-white animate-ping inline-block" />
          Nueva orden recibida
        </div>
      )}

      {/* Header */}
      <header className="px-5 pt-5 pb-2 flex items-center justify-between relative">
        {/* Hamburger menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
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
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 transition-colors"
              >
                <PrinterIcon className="w-4 h-4 shrink-0" />
                Impresoras
              </button>
              <button
                onClick={() => {
                  onOpenHistorial();
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/10 transition-colors"
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
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-rose-400 hover:bg-white/10 transition-colors"
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
          onClick={() => fetchOrders(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors text-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </header>

      {/* Logo central */}
      <div className="flex flex-col items-center pb-6 gap-1">
        <h1 className="text-white font-semibold text-xl">Even Crew</h1>
        {!branchesLoading && branches.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setBranchOpen((v) => !v)}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white/80 text-sm rounded-full px-4 py-1.5 border border-white/10 transition-colors"
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
                      className="w-full flex items-center justify-between gap-4 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
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
        <p className="text-white/50 text-sm">
          {orders.length} orden(es) pendiente(s)
        </p>
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
              className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium hover:bg-white/30"
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
