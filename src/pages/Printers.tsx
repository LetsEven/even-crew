import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  ArrowLeft,
  Wifi,
  PrinterIcon,
  Loader2,
  Play,
  Check,
  X,
  ChevronDown,
  Cable,
  Crown,
  Monitor,
  Trash2,
} from "lucide-react";
import { usePrinters } from "../hooks/usePrinters";
import {
  getBranches,
  getPrinters,
  syncPrinters,
  updatePrinter,
  deletePrinter,
  type Branch,
  type PrinterRecord,
} from "../services/api";
import type { CrewDevice } from "../hooks/useSocket";

const ROLES = [
  {
    value: "bar",
    label: "Bar",
    color: "bg-sky-500/20 text-sky-300 ring-sky-500/30",
  },
  {
    value: "kitchen",
    label: "Cocina",
    color: "bg-orange-500/20 text-orange-300 ring-orange-500/30",
  },
  {
    value: "other",
    label: "Otro",
    color: "bg-purple-500/20 text-purple-300 ring-purple-500/30",
  },
  {
    value: "all",
    label: "Todos",
    color: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30",
  },
] as const;

function RoleBadge({ role }: { role: string }) {
  const r = ROLES.find((r) => r.value === role);
  if (!r) return null;
  return (
    <span
      className={`mt-1 self-start inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${r.color}`}
    >
      {r.label}
    </span>
  );
}

interface Props {
  onBack: () => void;
  deviceId: string;
  connectedDevices: CrewDevice[];
  masterDeviceId: string | null;
  setMaster: (deviceId: string) => void;
  onBranchChange: (id: string) => void;
}

interface EditState {
  name: string;
  role: string;
}

export default function Printers({
  onBack,
  deviceId,
  connectedDevices,
  masterDeviceId,
  setMaster,
  onBranchChange,
}: Props) {
  const { getToken } = useAuth();
  const {
    scanning,
    testingIp,
    scan,
    printTest,
    usbDevices,
    scanningUsb,
    testingUsbDevice,
    scanUsb,
    printTestUsb,
  } = usePrinters();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [branchOpen, setBranchOpen] = useState(false);
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!branchOpen) return;
    const handler = (e: MouseEvent) => {
      if (!branchDropdownRef.current?.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchOpen]);
  const [printers, setPrinters] = useState<PrinterRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", role: "" });
  const [savingId, setSavingId] = useState<string | null>(null);

  // Estado para edición de impresoras USB (pending — no tienen ID aún)
  const [editingUsbDevice, setEditingUsbDevice] = useState<string | null>(null);
  const [editUsbState, setEditUsbState] = useState<EditState>({
    name: "",
    role: "",
  });
  const [savingUsbDevice, setSavingUsbDevice] = useState<string | null>(null);
  const [usbError, setUsbError] = useState<string | null>(null);

  // Load branches on mount
  useEffect(() => {
    setBranchesLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const list = await getBranches(token);
        setBranches(list);
        const saved = localStorage.getItem("crew_branch_id");
        const match = list.find((b) => b.id === saved);
        if (match) {
          setLoading(true);
          setSelectedBranch(match.id);
          onBranchChange(match.id);
        } else if (list.length === 1) {
          setLoading(true);
          setSelectedBranch(list[0].id);
          localStorage.setItem("crew_branch_id", list[0].id);
          onBranchChange(list[0].id);
        }
      } catch (e: any) {
        setError(e?.message || "Error al cargar sucursales");
      } finally {
        setBranchesLoading(false);
      }
    })();
  }, [getToken]);

  // Load printers when branch changes
  const loadPrinters = useCallback(
    async (branchId: string) => {
      const token = await getToken();
      if (!token || !branchId) return;
      setLoading(true);
      setError(null);
      try {
        const list = await getPrinters(branchId);
        setPrinters(list);
      } catch (e: any) {
        setError(e?.message || "Error al cargar impresoras");
      } finally {
        setLoading(false);
      }
    },
    [getToken],
  );

  useEffect(() => {
    if (selectedBranch) loadPrinters(selectedBranch);
  }, [selectedBranch, loadPrinters]);

  // WiFi scan
  const handleScan = useCallback(async () => {
    if (!selectedBranch) return;
    const found = await scan();
    if (found.length === 0) return;
    const token = await getToken();
    if (!token) return;
    try {
      const updated = await syncPrinters(token, selectedBranch, found);
      setPrinters(updated);
    } catch (e: any) {
      setError(e?.message || "Error al sincronizar impresoras");
    }
  }, [scan, getToken, selectedBranch]);

  // USB scan — solo detecta localmente, NO guarda en DB todavía
  const handleScanUsb = useCallback(async () => {
    setUsbError(null);
    try {
      await scanUsb();
    } catch (e: any) {
      setUsbError(e?.message || String(e));
    }
  }, [scanUsb]);

  // WiFi edit
  const startEdit = (p: PrinterRecord) => {
    setEditingId(p.id);
    setEditState({ name: p.name ?? "", role: p.role ?? "" });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setConfirmDeleteId(null);
  };
  const saveEdit = async (printerId: string) => {
    const token = await getToken();
    if (!token) return;
    setSavingId(printerId);
    try {
      const updated = await updatePrinter(token, printerId, {
        name: editState.name || undefined,
        role: editState.role || undefined,
      });
      setPrinters((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      setEditingId(null);
    } catch (e: any) {
      setError(e?.message || "Error al guardar");
    } finally {
      setSavingId(null);
    }
  };

  // USB edit — impresoras ya guardadas en DB
  const startEditUsb = (p: PrinterRecord) => {
    setEditingUsbDevice(p.usb_device_name!);
    setEditUsbState({ name: p.name ?? "", role: p.role ?? "" });
  };
  const cancelEditUsb = () => {
    setEditingUsbDevice(null);
    setConfirmDeleteId(null);
  };
  const saveEditUsb = async (printerId: string) => {
    const token = await getToken();
    if (!token) return;
    setSavingUsbDevice(printerId);
    try {
      const updated = await updatePrinter(token, printerId, {
        name: editUsbState.name || undefined,
        role: editUsbState.role || undefined,
      });
      setPrinters((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      setEditingUsbDevice(null);
    } catch (e: any) {
      setUsbError(e?.message || "Error al guardar");
    } finally {
      setSavingUsbDevice(null);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (printerId: string) => {
    const token = await getToken();
    if (!token) return;
    setDeletingId(printerId);
    try {
      await deletePrinter(token, printerId);
      setPrinters((prev) => prev.filter((p) => p.id !== printerId));
      setEditingId(null);
      setEditingUsbDevice(null);
      setConfirmDeleteId(null);
    } catch (e: any) {
      setError(e?.message || "Error al eliminar");
    } finally {
      setDeletingId(null);
    }
  };

  // USB nuevo — dispositivo detectado localmente, aún no en DB
  const [editingNewUsb, setEditingNewUsb] = useState<string | null>(null);
  const [editNewUsbState, setEditNewUsbState] = useState<EditState>({
    name: "",
    role: "",
  });
  const [savingNewUsb, setSavingNewUsb] = useState<string | null>(null);

  const saveNewUsb = async (deviceName: string) => {
    if (!editNewUsbState.role) {
      setUsbError("Asigna un rol antes de guardar.");
      return;
    }
    const token = await getToken();
    if (!token || !selectedBranch) return;
    setSavingNewUsb(deviceName);
    setUsbError(null);
    try {
      const updated = await syncPrinters(token, selectedBranch, [
        {
          usb_device_name: deviceName,
          connection_type: "usb",
        },
      ]);
      // Ahora actualizar nombre y rol del registro recién creado
      const created = updated.find((p) => p.usb_device_name === deviceName);
      if (created) {
        const final = await updatePrinter(token, created.id, {
          name: editNewUsbState.name || undefined,
          role: editNewUsbState.role,
        });
        setPrinters((prev) => {
          const exists = prev.find((p) => p.id === final.id);
          return exists
            ? prev.map((p) => (p.id === final.id ? final : p))
            : [...prev, final];
        });
      }
      setEditingNewUsb(null);
    } catch (e: any) {
      setUsbError(e?.message || "Error al guardar");
    } finally {
      setSavingNewUsb(null);
    }
  };

  // Handle USB test — show friendly message on permission request
  const handleTestUsb = useCallback(
    async (deviceName: string) => {
      try {
        await printTestUsb(deviceName);
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("USB_PERMISSION_REQUESTED")) {
          setUsbError(
            "Permiso USB solicitado — acepta el diálogo y toca Test de nuevo.",
          );
        } else {
          setUsbError(msg);
        }
      }
    },
    [printTestUsb],
  );

  const selectedBranchName =
    branches.find((b) => b.id === selectedBranch)?.name ??
    "Seleccionar sucursal";

  // Always include the current device so "Este dispositivo" never disappears
  // during socket reconnects or when the server list arrives late.
  const displayedDevices = useMemo(() => {
    if (connectedDevices.some((d) => d.deviceId === deviceId))
      return connectedDevices;
    return [
      { deviceId, socketId: null, connectedAt: null, online: true },
      ...connectedDevices,
    ];
  }, [connectedDevices, deviceId]);

  const wifiPrinters = printers.filter((p) => p.connection_type !== "usb");
  const usbPrinters = printers.filter((p) => p.connection_type === "usb");

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: "linear-gradient(to bottom right, #0a8b9b, #0d3d43)",
      }}
    >
      {/* Header */}
      <header className="px-5 pt-5 pb-2 flex items-center justify-between">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-white font-semibold text-base">Impresoras</h1>
        <button
          onClick={handleScan}
          disabled={scanning || !selectedBranch}
          className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {scanning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
        </button>
      </header>

      {/* Panel */}
      <div
        className="flex-1 rounded-t-4xl px-5 pt-6 pb-6 flex flex-col gap-4 mt-4"
        style={{
          background: "rgba(10, 50, 56, 0.85)",
          backdropFilter: "blur(10px)",
        }}
      >
        {/* Branch selector */}
        <div className="relative" ref={branchDropdownRef}>
          <button
            onClick={() => setBranchOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white/10 rounded-2xl text-white text-sm cursor-pointer"
          >
            <span>{selectedBranchName}</span>
            <ChevronDown
              className={`w-4 h-4 text-white/50 transition-transform ${branchOpen ? "rotate-180" : ""}`}
            />
          </button>
          {branchOpen && (
            <ul className="absolute z-10 top-full mt-1 w-full bg-[#0a3238] border border-white/10 rounded-2xl overflow-hidden shadow-lg">
              {branches.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => {
                      setSelectedBranch(b.id);
                      localStorage.setItem("crew_branch_id", b.id);
                      onBranchChange(b.id);
                      setBranchOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors cursor-pointer ${
                      selectedBranch === b.id
                        ? "text-white bg-white/15"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Dispositivos conectados */}
        <div>
          <p className="text-white/50 text-xs uppercase tracking-wide px-1 mb-2">
            Dispositivos conectados · {displayedDevices.length}
          </p>
          <ul className="flex flex-col gap-2">
            {displayedDevices.map((d) => {
              const isMe = d.deviceId === deviceId;
              const isMaster = d.deviceId === masterDeviceId;
              const isOffline = !d.online;
              return (
                <li
                  key={d.deviceId}
                  className={`flex items-center justify-between px-4 py-3 rounded-2xl ring-1 transition-colors ${
                    isMaster && !isOffline
                      ? "bg-emerald-500/15 ring-emerald-500/30"
                      : isMaster && isOffline
                        ? "bg-amber-500/10 ring-amber-500/20"
                        : "bg-white/5 ring-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isMaster ? (
                      <Crown
                        className={`w-4 h-4 shrink-0 ${isOffline ? "text-amber-400/60" : "text-emerald-400"}`}
                      />
                    ) : (
                      <Monitor className="w-4 h-4 text-white/30 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${
                          isMaster && !isOffline
                            ? "text-emerald-300"
                            : isMaster && isOffline
                              ? "text-amber-300/70"
                              : "text-white/70"
                        }`}
                      >
                        {isMe ? "Este dispositivo" : "Dispositivo"}
                        {isMaster && !isOffline && " · Master"}
                        {isMaster && isOffline && " · Master (offline)"}
                      </p>
                      <p className="text-xs text-white/30 font-mono">
                        {d.deviceId.slice(0, 8)}
                      </p>
                    </div>
                  </div>
                  {!isMaster && (
                    <button
                      onClick={() => setMaster(d.deviceId)}
                      className="ml-3 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs rounded-full transition-colors cursor-pointer shrink-0"
                    >
                      Set Master
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Content */}
        {branchesLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-white/50" />
          </div>
        ) : !selectedBranch ? (
          <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
            Selecciona una sucursal para ver sus impresoras
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-white/50" />
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/70">
            <p className="text-sm text-center">{error}</p>
            <button
              onClick={() => loadPrinters(selectedBranch)}
              className="px-4 py-2 bg-white/20 text-white rounded-full text-sm font-medium hover:bg-white/30 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            {/* ── Sección WiFi ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/50 text-xs uppercase tracking-wide px-1">
                  WiFi · {wifiPrinters.length} impresora(s)
                </p>
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scanning ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Wifi className="w-3 h-3" />
                  )}
                  Escanear
                </button>
              </div>

              {wifiPrinters.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-4 text-white/40">
                  <PrinterIcon className="w-8 h-8 opacity-30" />
                  <p className="text-xs">
                    No hay impresoras WiFi. Toca Escanear.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {wifiPrinters.map((p) =>
                    editingId === p.id ? (
                      <li
                        key={p.id}
                        className="bg-white/10 rounded-2xl px-4 py-3 flex flex-col gap-3"
                      >
                        <p className="text-white/50 text-xs font-mono">
                          {p.ip}:{p.port}
                        </p>
                        <input
                          value={editState.name}
                          onChange={(e) =>
                            setEditState((s) => ({
                              ...s,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Nombre (ej. Barra, Cocina 1)"
                          className="w-full px-3 py-2 bg-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                        />
                        <div className="flex gap-2 flex-wrap">
                          {ROLES.map((r) => (
                            <button
                              key={r.value}
                              onClick={() =>
                                setEditState((s) => ({ ...s, role: r.value }))
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-medium ring-1 transition-colors cursor-pointer ${
                                editState.role === r.value
                                  ? r.color
                                  : "bg-white/5 text-white/40 ring-white/10 hover:bg-white/10 hover:text-white/70"
                              }`}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center justify-between">
                            <span className="text-white/40 text-xs">
                              ¿Eliminar impresora?
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/60 text-xs rounded-full transition-colors cursor-pointer"
                              >
                                No
                              </button>
                              <button
                                onClick={() => handleDelete(p.id)}
                                disabled={deletingId === p.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deletingId === p.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : null}
                                Eliminar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex gap-1">
                              <button
                                onClick={cancelEdit}
                                className="p-2 rounded-lg text-white/50 hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(p.id)}
                                className="p-2 rounded-lg text-white/25 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <button
                              onClick={() => saveEdit(p.id)}
                              disabled={savingId === p.id}
                              className="flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {savingId === p.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Guardar
                            </button>
                          </div>
                        )}
                      </li>
                    ) : (
                      <li
                        key={p.id}
                        className="flex items-center justify-between bg-white/10 rounded-2xl px-4 py-3"
                      >
                        <button
                          className="flex flex-col gap-0.5 text-left flex-1 min-w-0 cursor-pointer"
                          onClick={() => startEdit(p)}
                        >
                          {p.name ? (
                            <span className="text-white text-sm font-medium truncate">
                              {p.name}
                            </span>
                          ) : (
                            <span className="text-white/30 text-sm italic">
                              Sin nombre — toca para editar
                            </span>
                          )}
                          <span className="text-white/50 text-xs font-mono">
                            {p.ip}:{p.port}
                          </span>
                          {p.role && <RoleBadge role={p.role} />}
                        </button>
                        <button
                          onClick={() => printTest(p.ip!, p.port!)}
                          disabled={testingIp === p.ip}
                          className="ml-3 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        >
                          {testingIp === p.ip ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          Test
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>

            {/* ── Sección USB ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/50 text-xs uppercase tracking-wide px-1">
                  USB · {usbPrinters.length} impresora(s)
                </p>
                <button
                  onClick={handleScanUsb}
                  disabled={scanningUsb}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scanningUsb ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Cable className="w-3 h-3" />
                  )}
                  Detectar USB
                </button>
              </div>

              {usbError && (
                <p className="text-amber-400 text-xs px-1 mb-2">{usbError}</p>
              )}

              {/* Impresoras USB ya guardadas en DB */}
              {usbPrinters.length > 0 && (
                <ul className="flex flex-col gap-3 mb-3">
                  {usbPrinters.map((p) =>
                    editingUsbDevice === p.usb_device_name ? (
                      <li
                        key={p.id}
                        className="bg-white/10 rounded-2xl px-4 py-3 flex flex-col gap-3"
                      >
                        <p className="text-white/50 text-xs font-mono truncate">
                          {p.usb_device_name}
                        </p>
                        <input
                          value={editUsbState.name}
                          onChange={(e) =>
                            setEditUsbState((s) => ({
                              ...s,
                              name: e.target.value,
                            }))
                          }
                          placeholder="Nombre (ej. Barra USB)"
                          className="w-full px-3 py-2 bg-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                        />
                        <div className="flex gap-2 flex-wrap">
                          {ROLES.map((r) => (
                            <button
                              key={r.value}
                              onClick={() =>
                                setEditUsbState((s) => ({
                                  ...s,
                                  role: r.value,
                                }))
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-medium ring-1 transition-colors cursor-pointer ${
                                editUsbState.role === r.value
                                  ? r.color
                                  : "bg-white/5 text-white/40 ring-white/10 hover:bg-white/10 hover:text-white/70"
                              }`}
                            >
                              {r.label}
                            </button>
                          ))}
                        </div>
                        {confirmDeleteId === p.id ? (
                          <div className="flex items-center justify-between">
                            <span className="text-white/40 text-xs">
                              ¿Eliminar impresora?
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/60 text-xs rounded-full transition-colors cursor-pointer"
                              >
                                No
                              </button>
                              <button
                                onClick={() => handleDelete(p.id)}
                                disabled={deletingId === p.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {deletingId === p.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : null}
                                Eliminar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="flex gap-1">
                              <button
                                onClick={cancelEditUsb}
                                className="p-2 rounded-lg text-white/50 hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(p.id)}
                                className="p-2 rounded-lg text-white/25 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            <button
                              onClick={() => saveEditUsb(p.id)}
                              disabled={savingUsbDevice === p.id}
                              className="flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {savingUsbDevice === p.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Guardar
                            </button>
                          </div>
                        )}
                      </li>
                    ) : (
                      <li
                        key={p.id}
                        className="flex items-center justify-between bg-white/10 rounded-2xl px-4 py-3"
                      >
                        <button
                          className="flex flex-col gap-0.5 text-left flex-1 min-w-0 cursor-pointer"
                          onClick={() => startEditUsb(p)}
                        >
                          {p.name ? (
                            <span className="text-white text-sm font-medium truncate">
                              {p.name}
                            </span>
                          ) : (
                            <span className="text-white/30 text-sm italic">
                              Sin nombre — toca para editar
                            </span>
                          )}
                          <span className="text-white/40 text-xs font-mono truncate">
                            {p.usb_device_name}
                          </span>
                          {p.role && <RoleBadge role={p.role} />}
                        </button>
                        <button
                          onClick={() => handleTestUsb(p.usb_device_name!)}
                          disabled={testingUsbDevice === p.usb_device_name}
                          className="ml-3 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        >
                          {testingUsbDevice === p.usb_device_name ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          Test
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}

              {/* Dispositivos detectados localmente, aún no guardados */}
              {(() => {
                const savedDeviceNames = new Set(
                  usbPrinters.map((p) => p.usb_device_name),
                );
                const newDevices = usbDevices.filter(
                  (d) => !savedDeviceNames.has(d.device_name),
                );
                if (newDevices.length === 0 && usbPrinters.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center gap-2 py-4 text-white/40">
                      <Cable className="w-8 h-8 opacity-30" />
                      <p className="text-xs text-center">
                        No hay impresoras USB detectadas.{"\n"}Asegúrate de que
                        la impresora aparezca en{"\n"}Configuración → Impresoras
                        y escáneres.
                      </p>
                    </div>
                  );
                }
                if (newDevices.length === 0) return null;
                return (
                  <>
                    <p className="text-white/30 text-xs px-1 mb-2">
                      Detectadas — asigna un rol para guardar
                    </p>
                    <ul className="flex flex-col gap-3">
                      {newDevices.map((d) =>
                        editingNewUsb === d.device_name ? (
                          <li
                            key={d.device_name}
                            className="bg-white/10 rounded-2xl px-4 py-3 flex flex-col gap-3 ring-1 ring-white/20"
                          >
                            <p className="text-white/50 text-xs font-mono truncate">
                              {d.device_name}
                            </p>
                            <input
                              value={editNewUsbState.name}
                              onChange={(e) =>
                                setEditNewUsbState((s) => ({
                                  ...s,
                                  name: e.target.value,
                                }))
                              }
                              placeholder="Nombre (ej. Barra USB)"
                              className="w-full px-3 py-2 bg-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                            />
                            <div className="flex gap-2 flex-wrap">
                              {ROLES.map((r) => (
                                <button
                                  key={r.value}
                                  onClick={() =>
                                    setEditNewUsbState((s) => ({
                                      ...s,
                                      role: r.value,
                                    }))
                                  }
                                  className={`px-3 py-1.5 rounded-full text-xs font-medium ring-1 transition-colors cursor-pointer ${
                                    editNewUsbState.role === r.value
                                      ? r.color
                                      : "bg-white/5 text-white/40 ring-white/10 hover:bg-white/10 hover:text-white/70"
                                  }`}
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setEditingNewUsb(null)}
                                className="p-2 rounded-lg text-white/50 hover:bg-white/10 cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => saveNewUsb(d.device_name)}
                                disabled={
                                  savingNewUsb === d.device_name ||
                                  !editNewUsbState.role
                                }
                                className="flex items-center gap-1.5 px-4 py-2 bg-white/20 hover:bg-white/30 text-white text-xs rounded-full cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {savingNewUsb === d.device_name ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                Guardar
                              </button>
                            </div>
                          </li>
                        ) : (
                          <li
                            key={d.device_name}
                            className="flex items-center justify-between bg-white/5 rounded-2xl px-4 py-3 ring-1 ring-white/10"
                          >
                            <button
                              className="flex flex-col gap-0.5 text-left flex-1 min-w-0 cursor-pointer"
                              onClick={() => {
                                setEditingNewUsb(d.device_name);
                                setEditNewUsbState({ name: "", role: "" });
                              }}
                            >
                              <span className="text-white/50 text-sm italic">
                                Sin configurar — toca para asignar rol
                              </span>
                              <span className="text-white/30 text-xs font-mono truncate">
                                {d.device_name}
                              </span>
                            </button>
                            <button
                              onClick={() => handleTestUsb(d.device_name)}
                              disabled={testingUsbDevice === d.device_name}
                              className="ml-3 flex items-center gap-1.5 px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                            >
                              {testingUsbDevice === d.device_name ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Play className="w-3 h-3" />
                              )}
                              Test
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
