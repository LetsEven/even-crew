import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getPrinters, type PrinterRecord } from "../services/api";

const BRANCH_KEY = "crew_branch_id";
const DEVICE_ID_KEY = "crew_device_id";

export interface PrintJobData {
  branchId: string;
  jobId?: string; // ID en print_job_queue — presente cuando viene de la cola confiable
  wasFlowHeld?: boolean;
  notifyOnPrint?: boolean;
  items: {
    name: string;
    quantity: number;
    clasificacion: number | null;
    custom_fields?:
      | { fieldName: string; selectedOptions: { optionName: string }[] }[]
      | null;
    special_instructions?: string | null;
  }[];
  orderInfo: {
    identifier: string;
    folio?: string | number | null;
    orderedBy?: string | null;
  };
}

// Maps clasificacion → printer roles that handle it
function printsThisItem(
  printerRole: string,
  clasificacion: number | null,
): boolean {
  if (printerRole === "all") return true;
  if (clasificacion === 1) return printerRole === "bar";
  if (clasificacion === 2) return printerRole === "kitchen";
  if (clasificacion === 3) return printerRole === "other";
  return false;
}

function encodeText(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  return bytes;
}

const ROLE_LABEL: Record<string, string> = {
  bar: "BARRA",
  kitchen: "COCINA",
  other: "OTROS",
  all: "GENERAL",
};

type TicketItem = {
  name: string;
  quantity: number;
  custom_fields?:
    | { fieldName: string; selectedOptions: { optionName: string }[] }[]
    | null;
  special_instructions?: string | null;
};

function buildTicket(
  items: TicketItem[],
  identifier: string,
  role: string,
  folio: string | number,
  orderedBy?: string | null,
): number[] {
  const buf: number[] = [];
  const now = new Date();
  const fecha =
    `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ` +
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const roleLabel = ROLE_LABEL[role] ?? "GENERAL";
  const ordenLabel = String(folio).padStart(5, "0");

  buf.push(0x1b, 0x40); // Init
  buf.push(0x1b, 0x61, 0x01); // Align center
  buf.push(0x1b, 0x21, 0x30); // Double size
  buf.push(...encodeText("\n== CUENTA NUEVA ==\n"));
  buf.push(...encodeText(`== ${ordenLabel} ==\n`));
  if (orderedBy) {
    buf.push(...encodeText(`${orderedBy.toUpperCase()}\n`));
  }
  buf.push(0x1b, 0x61, 0x00); // Align left
  buf.push(0x1b, 0x21, 0x10); // Double width
  const num = identifier.match(/\d+/)?.[0];
  let mesaLine: string;
  if (/habitaci/i.test(identifier) || /cuarto/i.test(identifier)) {
    mesaLine = `HABITACION: ${num || identifier} MESERO: EVEN\n\n`;
  } else if (/pick/i.test(identifier)) {
    mesaLine = `MESERO: EVEN\n\n`;
  } else {
    mesaLine = `MESA: ${num ? String(num).padStart(2, "0") : identifier} MESERO: EVEN\n\n`;
  }
  buf.push(...encodeText(`\n${roleLabel} ORDEN: ${ordenLabel}\n`));
  buf.push(...encodeText(`${fecha}\n`));
  buf.push(...encodeText(mesaLine));
  buf.push(...encodeText("========================\n"));
  for (const item of items) {
    buf.push(...encodeText(`${item.quantity} ${item.name.toUpperCase()}\n`));
    if (item.custom_fields) {
      for (const field of item.custom_fields) {
        const opts = field.selectedOptions.map((o) => o.optionName).join(", ");
        buf.push(...encodeText(`  ${field.fieldName}: ${opts}\n`));
      }
    }
    if (item.special_instructions) {
      buf.push(...encodeText(`  Nota: ${item.special_instructions}\n`));
    }
  }
  buf.push(...encodeText("========================\n"));
  buf.push(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00); // Feed + cut

  return buf;
}

export function usePrinting() {
  const printersRef = useRef<PrinterRecord[]>([]);
  const branchIdRef = useRef<string | null>(null);
  const masterDeviceIdRef = useRef<string | null>(null);

  useEffect(() => {
    const branchId = localStorage.getItem(BRANCH_KEY);
    if (!branchId) return;
    branchIdRef.current = branchId;

    getPrinters(branchId)
      .then((list) => {
        printersRef.current = list.filter(
          (p) => p.is_active !== false && p.role,
        );
        console.log(
          `[PRINT] ${printersRef.current.length} impresora(s) cargadas para branch ${branchId}`,
        );
      })
      .catch((e) => {
        console.warn("[PRINT] No se pudieron cargar impresoras:", e);
      });
  }, []);

  const printJob = useCallback(async (data: PrintJobData) => {
    const myDeviceId = localStorage.getItem(DEVICE_ID_KEY);
    const masterDeviceId = masterDeviceIdRef.current;
    console.log(
      `[PRINT] printJob llamado — myDevice=${myDeviceId} master=${masterDeviceId} dataBranch=${data.branchId} myBranch=${branchIdRef.current}`,
    );

    if (!myDeviceId || myDeviceId !== masterDeviceId) {
      console.log("[PRINT] Omitido — este dispositivo no es Master");
      return;
    }
    if (data.branchId !== branchIdRef.current) {
      console.log(
        `[PRINT] Omitido — branchId no coincide (data=${data.branchId} vs local=${branchIdRef.current})`,
      );
      return;
    }

    const printers = printersRef.current;
    console.log(`[PRINT] Impresoras disponibles: ${printers.length}`);
    if (printers.length === 0) return;

    for (const printer of printers) {
      if (!printer.role) continue;

      const printerItems = data.items
        .filter((item) => printsThisItem(printer.role!, item.clasificacion))
        .map(({ name, quantity, custom_fields, special_instructions }) => ({
          name,
          quantity,
          custom_fields,
          special_instructions,
        }));

      console.log(
        `[PRINT] Impresora role=${printer.role} type=${printer.connection_type} — items a imprimir: ${printerItems.length}`,
      );
      if (printerItems.length === 0) continue;

      const ticket = buildTicket(
        printerItems,
        data.orderInfo.identifier,
        printer.role,
        data.orderInfo.folio ?? "",
        data.orderInfo.orderedBy,
      );

      if (printer.connection_type === "usb" && printer.usb_device_name) {
        console.log(`[PRINT] 🖨️ Enviando a USB: ${printer.usb_device_name}`);
        await invoke("print_raw_usb", {
          printerName: printer.usb_device_name,
          data: ticket,
        }).catch((e) =>
          console.error(`[PRINT] ❌ Error USB ${printer.usb_device_name}:`, e),
        );
      } else if (printer.ip && printer.port) {
        console.log(
          `[PRINT] 🖨️ Enviando a WiFi: ${printer.ip}:${printer.port}`,
        );
        await invoke("print_raw", {
          ip: printer.ip,
          port: printer.port,
          data: ticket,
        }).catch((e) =>
          console.error(`[PRINT] ❌ Error WiFi ${printer.ip}:`, e),
        );
      }
    }
  }, []);

  const setMasterDeviceId = useCallback((id: string | null) => {
    masterDeviceIdRef.current = id;
  }, []);

  return { printJob, setMasterDeviceId };
}
