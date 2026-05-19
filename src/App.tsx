import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth, useSignIn } from "@clerk/clerk-react";
import { Mail, KeyRound, Loader2, Eye, EyeOff } from "lucide-react";
import Kitchen from "./pages/Kitchen";
import Printers from "./pages/Printers";
import { useSocket } from "./hooks/useSocket";
import type { CrewDevice } from "./hooks/useSocket";
import { usePrinting } from "./hooks/usePrinting";
import { useKitchenOrders } from "./hooks/useKitchenOrders";
import { getBranches } from "./services/api";
import type { Branch } from "./services/api";
import type { DishStatus } from "./types";
import { getOrCreateDeviceId } from "./utils/deviceId";

type Page = "kitchen" | "printers";

async function showWindowIfNeeded() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const isVisible = await win.isVisible();
    const isMinimized = await win.isMinimized();
    if (!isVisible || isMinimized) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("show_main_window");
    }
  } catch {}
}

// Inicializar permisos de notificación al arrancar (no en cada orden)
async function initNotifications() {
  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );
    const granted = await isPermissionGranted();
    if (!granted) await requestPermission();
    console.log("[CREW:NOTIF] Permisos inicializados");
  } catch {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  }
}

async function sendDesktopNotification(title: string, body: string) {
  console.log(`[CREW:NOTIF] Enviando notificación: ${title} — ${body}`);
  try {
    // Usar comando Rust con PowerShell toast — más confiable en .exe portable Windows
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("notify_new_order", { title, body });
    console.log("[CREW:NOTIF] ✅ Notificación enviada via Rust");
  } catch (e) {
    console.warn("[CREW:NOTIF] Rust falló, intentando plugin Tauri:", e);
    try {
      const { sendNotification } = await import(
        "@tauri-apps/plugin-notification"
      );
      await sendNotification({ title, body });
    } catch (e2) {
      console.warn("[CREW:NOTIF] Plugin falló, intentando Web API:", e2);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    }
  }
}

export default function App() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signIn, setActive } = useSignIn();
  const [page, setPage] = useState<Page>("kitchen");
  const [branchId, setBranchId] = useState<string | null>(() =>
    localStorage.getItem("crew_branch_id"),
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  // Identidad y presencia de dispositivos
  const deviceId = getOrCreateDeviceId();
  const [connectedDevices, setConnectedDevices] = useState<CrewDevice[]>([]);
  const [masterDeviceId, setMasterDeviceId] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Estado de nueva orden (banner) — vive en App para no perderse al navegar
  const [newOrderAlert, setNewOrderAlert] = useState(false);
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inicializar permisos de notificación una sola vez al arrancar
  useEffect(() => {
    initNotifications();
  }, []);

  // F12 abre DevTools
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("open_devtools"))
          .catch(() => {});
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Cargar sucursales al estar autenticado
  useEffect(() => {
    if (!isSignedIn) return;
    setBranchesLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const list = await getBranches(token);
        setBranches(list);
      } catch {
      } finally {
        setBranchesLoading(false);
      }
    })();
  }, [isSignedIn, getToken]);

  const handleBranchChange = useCallback((id: string) => {
    setBranchId((prev) => {
      if (id !== prev) {
        setConnectedDevices([]);
        setMasterDeviceId(null);
      }
      return id;
    });
    localStorage.setItem("crew_branch_id", id);
  }, []);

  // Hooks que deben vivir toda la sesión (independiente de la página activa)
  const { printJob, setMasterDeviceId: setPrintingMaster } = usePrinting();

  const handleDevicesUpdated = useCallback(
    (devices: CrewDevice[], master: string | null) => {
      setConnectedDevices(devices);
      setMasterDeviceId(master);
      setPrintingMaster(master);
    },
    [setPrintingMaster],
  );

  const {
    orders,
    loading: ordersLoading,
    error: ordersError,
    fetchOrders,
    updateDish,
    updateOrderCookingStatus,
    removeOrder,
    updateDishFromSocket,
  } = useKitchenOrders(branchId);

  const handleOrderClosed = useCallback(
    (orderId: string) => removeOrder(orderId),
    [removeOrder],
  );
  const handleDishStatusChanged = useCallback(
    (dishId: string, status: DishStatus) =>
      updateDishFromSocket(dishId, status),
    [updateDishFromSocket],
  );
  const handleRefetch = useCallback(() => {
    console.log(
      "[CREW:ORDER] 🔔 Nueva orden recibida — ejecutando refetch + notificación",
    );
    fetchOrders();
    setNewOrderAlert(true);
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setNewOrderAlert(false), 3500);
    sendDesktopNotification("Even Crew", "Nueva orden recibida");
    showWindowIfNeeded();
  }, [fetchOrders]);

  const handleSilentRefetch = useCallback(() => {
    fetchOrders();
  }, [fetchOrders]);

  const { setMaster } = useSocket({
    branchId,
    deviceId,
    onOrderClosed: handleOrderClosed,
    onDishStatusChanged: handleDishStatusChanged,
    onRefetch: handleRefetch,
    onSilentRefetch: handleSilentRefetch,
    onPrintJob: printJob,
    onDevicesUpdated: handleDevicesUpdated,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn) return;

    setLoading(true);
    setError("");

    try {
      const result = await signIn.create({
        identifier: email,
        password,
      });

      if (result.status === "complete") {
        await setActive!({ session: result.createdSessionId });
      } else {
        setError("Error al iniciar sesión. Intenta de nuevo.");
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.message || "Credenciales incorrectas.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "linear-gradient(to bottom right, #0a8b9b, #153f43)",
        }}
      >
        <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div
        className="min-h-screen flex flex-col justify-center items-center px-6"
        style={{
          background: "linear-gradient(to bottom right, #0a8b9b, #153f43)",
        }}
      >
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="mb-8 flex flex-col items-center gap-3">
            <img
              src="/logo-short-green.webp"
              alt="Even"
              className="w-16 h-16"
            />
            <h1 className="text-white text-2xl font-semibold">Even Crew</h1>
            <p className="text-white/50 text-sm">
              Inicia sesión para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Email"
                autoComplete="username email"
                className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent"
              />
            </div>

            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="Contraseña"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-transparent [&::-ms-reveal]:hidden [&::-webkit-credentials-auto-fill-button]:hidden"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>

            {error && <p className="text-rose-400 text-sm px-1">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full py-3 rounded-full text-white font-medium transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
              style={{
                background: "linear-gradient(to right, #0a7a88, #0f2f34)",
              }}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Entrando..." : "Iniciar sesión"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (page === "printers") {
    return (
      <Printers
        onBack={() => {
          setBranchId(localStorage.getItem("crew_branch_id"));
          setPage("kitchen");
        }}
        deviceId={deviceId}
        connectedDevices={connectedDevices}
        masterDeviceId={masterDeviceId}
        setMaster={setMaster}
        onBranchChange={handleBranchChange}
      />
    );
  }

  return (
    <Kitchen
      onOpenPrinters={() => setPage("printers")}
      orders={orders}
      loading={ordersLoading}
      error={ordersError}
      fetchOrders={fetchOrders}
      updateDish={updateDish}
      updateOrderCookingStatus={updateOrderCookingStatus}
      newOrderAlert={newOrderAlert}
      branches={branches}
      branchesLoading={branchesLoading}
      branchId={branchId}
      onBranchChange={handleBranchChange}
    />
  );
}
