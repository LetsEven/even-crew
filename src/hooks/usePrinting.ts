import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getPrinters, type PrinterRecord } from "../services/api";
import { formatFolio } from "../utils/folio";

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

const asteriskCache = new Map<number, number[]>();

async function getAsteriskBytes(targetWidth = 44): Promise<number[]> {
  if (asteriskCache.has(targetWidth)) return asteriskCache.get(targetWidth)!;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
      img.src = "/asterisk-black-print.png";
    });
    const TARGET_W = targetWidth;
    const w = TARGET_W;
    const h = Math.round(TARGET_W * (img.naturalHeight / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const { data, width, height } = ctx.getImageData(0, 0, w, h);
    const bytesPerRow = Math.ceil(width / 8);
    const bitmap: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x < width) {
            const idx = (y * width + x) * 4;
            const luma =
              0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            if (luma < 128) byte |= 1 << (7 - bit);
          }
        }
        bitmap.push(byte);
      }
    }
    const xL = bytesPerRow & 0xff;
    const xH = (bytesPerRow >> 8) & 0xff;
    const yL = height & 0xff;
    const yH = (height >> 8) & 0xff;
    const bytes = [0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH, ...bitmap];
    asteriskCache.set(targetWidth, bytes);
    return bytes;
  } catch {
    asteriskCache.set(targetWidth, []);
    return [];
  }
}

type TicketItem = {
  name: string;
  quantity: number;
  custom_fields?:
    | { fieldName: string; selectedOptions: { optionName: string }[] }[]
    | null;
  special_instructions?: string | null;
};

async function buildTicket(
  items: TicketItem[],
  identifier: string,
  folio: string | number,
  orderedBy?: string | null,
): Promise<number[]> {
  const buf: number[] = [];
  const now = new Date();
  const fecha =
    `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()} ` +
    `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const ordenLabel = formatFolio(folio);

  buf.push(0x1b, 0x40); // Init
  buf.push(0x1b, 0x61, 0x01); // Align center
  buf.push(0x1b, 0x21, 0x30); // Double size
  const num = identifier.match(/\d+/)?.[0];
  buf.push(
    ...encodeText(`MESA ${num ? String(num).padStart(2, "0") : identifier}\n`),
  );
  if (orderedBy) {
    buf.push(...encodeText(`${orderedBy.toUpperCase()}\n`));
  }
  buf.push(0x1b, 0x61, 0x00); // Align left
  buf.push(0x1d, 0x21, 0x01); // Height x2, width x1 (taller but not wider)
  let mesaLine: string;
  if (/habitaci/i.test(identifier) || /cuarto/i.test(identifier)) {
    mesaLine = `HABITACION: ${num || identifier} MESERO: EVEN\n\n`;
  } else if (/pick/i.test(identifier)) {
    mesaLine = `MESERO: EVEN\n\n`;
  } else {
    mesaLine = `MESA: ${num ? String(num).padStart(2, "0") : identifier} MESERO: EVEN\n\n`;
  }
  buf.push(...encodeText(`\nNUMERO DE ORDEN: ${ordenLabel}\n`));
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

  buf.push(0x1d, 0x21, 0x00); // Reset size
  buf.push(0x1b, 0x61, 0x01); // Center
  const asteriskBytes = await getAsteriskBytes();
  if (asteriskBytes.length > 0) {
    buf.push(0x0a);
    buf.push(...asteriskBytes);
  }
  buf.push(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00); // Feed + cut

  return buf;
}

async function buildPriceTicket(
  dishes: { item: string; quantity: number; price?: number }[],
  identifier: string,
  qrUrl: string | null,
): Promise<number[]> {
  const WIDTH = 32;
  const buf: number[] = [];
  const now = new Date();
  const fecha = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const hora = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const num = identifier.match(/\d+/)?.[0];
  const mesaLabel = num
    ? `MESA ${String(num).padStart(2, "0")}`
    : identifier.toUpperCase();

  buf.push(0x1b, 0x40); // Init
  buf.push(0x1b, 0x61, 0x01); // Center

  buf.push(0x1b, 0x21, 0x30); // Double size
  buf.push(...encodeText(`${mesaLabel}\n`));
  buf.push(0x1b, 0x21, 0x00); // Normal
  buf.push(...encodeText(`${fecha}\n`));
  buf.push(...encodeText(`${hora}\n`));
  buf.push(0x1b, 0x61, 0x00); // Left
  buf.push(...encodeText("================================\n"));

  const total = dishes.reduce((sum, d) => sum + (d.price ?? 0) * d.quantity, 0);

  for (const dish of dishes) {
    const linePrice = (dish.price ?? 0) * dish.quantity;
    const priceStr = `$${linePrice.toFixed(2)}`;
    const prefix = dish.quantity > 1 ? `${dish.quantity}x ` : "";
    const nameRaw = `${prefix}${dish.item.toUpperCase()}`;
    const maxName = WIDTH - priceStr.length - 1;
    const name = nameRaw.length > maxName ? nameRaw.slice(0, maxName) : nameRaw;
    const line = `${name}${" ".repeat(WIDTH - name.length - priceStr.length)}${priceStr}\n`;
    buf.push(...encodeText(line));
  }

  buf.push(...encodeText("================================\n"));
  buf.push(0x1b, 0x45, 0x01); // Bold on
  const totalStr = `$${total.toFixed(2)}`;
  const totalLabel = "SUBTOTAL:";
  buf.push(
    ...encodeText(
      `${totalLabel}${" ".repeat(WIDTH - totalLabel.length - totalStr.length)}${totalStr}\n`,
    ),
  );
  buf.push(0x1b, 0x45, 0x00); // Bold off

  if (qrUrl) {
    buf.push(0x1b, 0x61, 0x01); // Center
    buf.push(0x0a); // blank line

    const urlBytes = qrUrl.split("").map((c) => c.charCodeAt(0) & 0xff);
    const dataLen = urlBytes.length + 3;
    const pL = dataLen & 0xff;
    const pH = (dataLen >> 8) & 0xff;

    buf.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // Model 2
    buf.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x08); // Module size 8
    buf.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x33); // Error correction H
    buf.push(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...urlBytes); // Store data
    buf.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // Print QR

    buf.push(...encodeText("\nEscanea para pagar\n"));
  }

  buf.push(0x1b, 0x61, 0x01); // Center
  const asteriskBytes = await getAsteriskBytes(56);
  if (asteriskBytes.length > 0) {
    buf.push(0x0a);
    buf.push(...asteriskBytes);
  }
  buf.push(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00); // Feed + cut
  return buf;
}

export async function printTapPayTicket(
  branchId: string,
  dishes: { item: string; quantity: number; price?: number }[],
  identifier: string,
  qrUrl: string | null,
): Promise<void> {
  const allPrinters = await getPrinters(branchId);
  const active = allPrinters.filter((p) => p.is_active !== false && p.role);
  if (active.length === 0) throw new Error("No hay impresoras configuradas");

  const ticket = await buildPriceTicket(dishes, identifier, qrUrl);

  for (const printer of active) {
    if (printer.connection_type === "usb" && printer.usb_device_name) {
      await invoke("print_raw_usb", {
        printerName: printer.usb_device_name,
        data: ticket,
      }).catch((e) => console.error("[PRINT] Error USB:", e));
    } else if (printer.ip && printer.port) {
      await invoke("print_raw", {
        ip: printer.ip,
        port: printer.port,
        data: ticket,
      }).catch((e) => console.error("[PRINT] Error WiFi:", e));
    }
  }
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

      const ticket = await buildTicket(
        printerItems,
        data.orderInfo.identifier,
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
