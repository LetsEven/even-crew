import type { CustomField, Dish, DishStatus } from "../types";
import { formatFolio } from "../utils/folio";

function getOptions(customFields: CustomField[] | null | undefined): string[] {
  if (!Array.isArray(customFields)) return [];
  return customFields
    .flatMap((f) =>
      (f.selectedOptions ?? []).map((o) => {
        const qty = o.quantity ?? 1;
        const val =
          f.fieldType === "dropdown-quantity" && qty > 1
            ? `x${qty} ${o.optionName}`
            : o.optionName;
        return `${f.fieldName}: ${val}`;
      }),
    )
    .filter(Boolean);
}

const STATUS_LABELS: Record<DishStatus, string> = {
  preparing: "Preparando",
  ready: "Listo",
  delivered: "Entregado",
};

const STATUS_BADGE: Record<DishStatus, string> = {
  preparing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ready: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  delivered: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
};

const BUTTON_ACTIVE: Record<DishStatus, string> = {
  preparing: "bg-amber-500 text-white border-amber-500",
  ready: "bg-blue-500 text-white border-blue-500",
  delivered: "bg-emerald-500 text-white border-emerald-500",
};

interface DishItemProps {
  dish: Dish;
  onStatusChange: (dishId: string, status: DishStatus) => void;
  hideStatusButtons?: boolean;
}

const STATUSES: DishStatus[] = ["preparing", "ready", "delivered"];

export default function DishItem({
  dish,
  onStatusChange,
  hideStatusButtons = false,
}: DishItemProps) {
  return (
    <div className="flex flex-col gap-3 pb-4 border-b border-white/10 last:border-0 last:pb-0">
      {/* Info del plato */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {dish.images?.[0] ? (
            <img
              src={dish.images[0]}
              alt={dish.item}
              className="w-11 h-11 rounded-xl object-cover shrink-0"
            />
          ) : (
            <div className="w-11 h-11 rounded-xl bg-white/10 shrink-0 flex items-center justify-center">
              <img
                src="/logo-short-green.webp"
                alt=""
                className="w-7 h-7 opacity-50"
              />
            </div>
          )}
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">
              {dish.quantity} {dish.item}
            </p>
            <p className="ml-2">
              {dish.userFolio && (
                <span className="shrink-0 text-lg font-mono font-semibold text-white/60">
                  #{formatFolio(dish.userFolio)}
                </span>
              )}
            </p>
            <p className="text-base text-white/50">
              {dish.orderedBy && <span>· {dish.orderedBy}</span>}
            </p>
            {(() => {
              const opts = getOptions(dish.customFields);
              return opts.length > 0 ? (
                <div className="mt-0.5">
                  {opts.map((opt, i) => (
                    <p key={i} className="text-xs text-white/50">
                      {opt}
                    </p>
                  ))}
                </div>
              ) : null;
            })()}
            {dish.specialInstructions && (
              <p className="text-base text-white/50 mt-0.5">
                Nota: {dish.specialInstructions}
              </p>
            )}
          </div>
        </div>
        {!hideStatusButtons && (
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium shrink-0 ${STATUS_BADGE[dish.status]}`}
          >
            {STATUS_LABELS[dish.status]}
          </span>
        )}
      </div>

      {/* Botones de status */}
      {!hideStatusButtons && (
        <div className="flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onStatusChange(dish.id, s)}
              disabled={dish.status === s}
              className={`flex-1 py-1 text-sm rounded-full font-medium border transition-all active:scale-95 ${
                dish.status === s
                  ? BUTTON_ACTIVE[s]
                  : "bg-transparent text-white/50 border-white/20 hover:border-white/40"
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
