import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { printTapPayTicket } from "../hooks/usePrinting";
import type { Order } from "../types";
import type { QRCodeRow } from "../services/api";

interface Props {
  order: Order;
  qrCode: QRCodeRow | null;
  branchId: string;
  onClose: () => void;
}

export default function PrintTicketModal({
  order,
  qrCode,
  branchId,
  onClose,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const tableNumber = parseInt(order.identifier.replace(/\D/g, ""), 10) || null;
  const dishTotal = order.dishes.reduce(
    (sum, d) => sum + (d.price ?? 0) * d.quantity,
    0,
  );
  const qrUrl = qrCode ? `https://letseven.io/qr/${qrCode.code}` : null;

  const handlePrint = async () => {
    setPrinting(true);
    setPrintError(null);
    try {
      await printTapPayTicket(branchId, order.dishes, order.identifier, qrUrl);
      onClose();
    } catch (e: any) {
      setPrintError(e?.message || "Error al imprimir");
    } finally {
      setPrinting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-9999 bg-black/75 flex items-center justify-center p-4">
      <div
        className="rounded-2xl overflow-hidden w-full max-w-sm"
        style={{
          background: "rgba(255,255,255,0.09)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/10 text-center">
          <p className="text-xs text-white/40 uppercase tracking-widest mb-1">
            Ticket
          </p>
          <h2 className="text-2xl font-bold text-white">
            {tableNumber != null ? `Mesa ${tableNumber}` : order.identifier}
          </h2>
        </div>

        {/* Dish list */}
        <div className="px-5 py-3">
          {order.dishes.map((dish) => (
            <div
              key={dish.id}
              className="flex justify-between py-2.5 border-b border-white/10 last:border-0"
            >
              <span className="text-sm text-white/80 capitalize">
                {dish.quantity > 1 ? `${dish.quantity}× ` : ""}
                {dish.item}
              </span>
              <span className="text-sm text-white font-medium shrink-0 ml-4">
                ${((dish.price ?? 0) * dish.quantity).toFixed(2)}
              </span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-1">
            <span className="text-base font-bold text-white">Total</span>
            <span className="text-base font-bold text-white">
              ${dishTotal.toFixed(2)}
            </span>
          </div>
        </div>

        {/* QR */}
        <div className="flex flex-col items-center px-5 pb-4 pt-2 gap-2">
          {qrUrl ? (
            <>
              <div className="bg-white p-3 rounded-2xl shadow-lg">
                <QRCodeSVG value={qrUrl} size={150} level="H" marginSize={0} />
              </div>
              <p className="text-xs text-white/40 text-center">
                Escanea para pagar
              </p>
            </>
          ) : (
            <p className="text-sm text-white/30 text-center py-4">
              Sin QR asignado
            </p>
          )}
        </div>

        {printError && (
          <p className="text-red-400 text-xs text-center px-5 pb-3">
            {printError}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onClose}
            disabled={printing}
            className="flex-1 py-2.5 rounded-xl bg-white/10 text-white/70 text-sm font-medium hover:bg-white/15 transition-colors cursor-pointer disabled:opacity-50"
          >
            Cerrar
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium transition-colors cursor-pointer disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {printing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Imprimiendo...
              </>
            ) : (
              "Imprimir"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
