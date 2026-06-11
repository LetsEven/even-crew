import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Minus, Plus, ChevronRight } from "lucide-react";
import { useAuth } from "@clerk/clerk-react";
import type { Order } from "../types";
import type {
  Branch,
  MenuSection,
  MenuItem,
  MenuItemCustomField,
} from "../services/api";
import { getRestaurantMenu, addDishToFlexBill } from "../services/api";

function parseTableNumber(identifier: string): number {
  const match = identifier.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

type CustomSelections = Record<
  string,
  string | string[] | Record<string, number>
>;

interface Props {
  order: Order;
  branch: Branch;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddDishModal({
  order,
  branch,
  onClose,
  onSuccess,
}: Props) {
  const { getToken } = useAuth();

  const [step, setStep] = useState(0);
  const [sections, setSections] = useState<MenuSection[]>([]);
  const [selectedSection, setSelectedSection] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [customSelections, setCustomSelections] = useState<CustomSelections>(
    {},
  );
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [guestName, setGuestName] = useState("");
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const menu = await getRestaurantMenu(
          branch.restaurant_id,
          branch.branch_number,
          token,
        );
        if (cancelled) return;
        const activeSecs = menu.filter((s) => s.is_active);
        setSections(activeSecs);
        if (activeSecs.length > 0) setSelectedSection(activeSecs[0].id);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingMenu(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, branch.restaurant_id, branch.branch_number]);

  const visibleItems = useMemo(() => {
    const sec = sections.find((s) => s.id === selectedSection);
    return (sec?.items ?? []).filter(
      (i) => i.is_available && !i.is_out_of_stock,
    );
  }, [sections, selectedSection]);

  const totalPrice = useMemo(() => {
    if (!selectedItem) return 0;
    const base =
      selectedItem.discount > 0
        ? selectedItem.price * (1 - selectedItem.discount / 100)
        : selectedItem.price;
    let extra = 0;
    for (const field of selectedItem.custom_fields ?? []) {
      const sel = customSelections[field.id];
      if (
        field.type === "dropdown-quantity" &&
        sel &&
        typeof sel === "object" &&
        !Array.isArray(sel)
      ) {
        for (const [optId, qty] of Object.entries(
          sel as Record<string, number>,
        )) {
          const opt = field.options?.find((o) => o.id === optId);
          if (opt && qty > 0) extra += opt.price * qty;
        }
      } else if (Array.isArray(sel)) {
        for (const optId of sel) {
          const opt = field.options?.find((o) => o.id === optId);
          if (opt) extra += opt.price;
        }
      }
    }
    return (base + extra) * quantity;
  }, [selectedItem, customSelections, quantity]);

  const isFormValid = useMemo(() => {
    if (!selectedItem) return false;
    for (const field of selectedItem.custom_fields ?? []) {
      if (field.type === "dropdown" && field.required) {
        const sel = customSelections[field.id] as string[] | undefined;
        if (!sel || sel.length === 0) return false;
      }
    }
    return true;
  }, [selectedItem, customSelections]);

  function handleDropdownChange(fieldId: string, optionId: string) {
    setCustomSelections((prev) => {
      const current = (prev[fieldId] as string[] | undefined) ?? [];
      return {
        ...prev,
        [fieldId]: current.includes(optionId) ? [] : [optionId],
      };
    });
  }

  function handleCheckboxChange(
    fieldId: string,
    optionId: string,
    field: MenuItemCustomField,
  ) {
    setCustomSelections((prev) => {
      const current = (prev[fieldId] as string[]) ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [fieldId]: current.filter((i) => i !== optionId) };
      }
      const max = field.maxSelections ?? 1;
      if (current.length >= max) return prev;
      return { ...prev, [fieldId]: [...current, optionId] };
    });
  }

  function handleQuantityChange(
    fieldId: string,
    optionId: string,
    qty: number,
  ) {
    setCustomSelections((prev) => {
      const current = (prev[fieldId] as Record<string, number>) ?? {};
      const updated = { ...current };
      if (qty > 0) updated[optionId] = qty;
      else delete updated[optionId];
      return { ...prev, [fieldId]: updated };
    });
  }

  function selectItem(item: MenuItem) {
    setSelectedItem(item);
    setCustomSelections({});
    setSpecialInstructions("");
    setQuantity(1);
    setStep(1);
  }

  async function handleConfirm() {
    if (!selectedItem || !isFormValid || !guestName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("No token");

      const basePrice =
        selectedItem.discount > 0
          ? selectedItem.price * (1 - selectedItem.discount / 100)
          : selectedItem.price;

      const customFieldsData = (selectedItem.custom_fields ?? [])
        .map((field) => {
          const sel = customSelections[field.id];
          let selectedOptions: Array<{
            optionId: string;
            optionName: string;
            price: number;
            quantity: number;
          }> = [];

          if (
            field.type === "dropdown-quantity" &&
            sel &&
            typeof sel === "object" &&
            !Array.isArray(sel)
          ) {
            selectedOptions = Object.entries(sel as Record<string, number>)
              .filter(([, q]) => q > 0)
              .map(([optId, q]) => {
                const opt = field.options?.find((o) => o.id === optId);
                return opt
                  ? {
                      optionId: opt.id,
                      optionName: opt.name,
                      price: opt.price,
                      quantity: q,
                    }
                  : null;
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
          } else if (Array.isArray(sel)) {
            selectedOptions =
              field.options
                ?.filter((o) => sel.includes(o.id))
                .map((o) => ({
                  optionId: o.id,
                  optionName: o.name,
                  price: o.price,
                  quantity: 1,
                })) ?? [];
          }

          return {
            fieldId: field.id,
            fieldName: field.name,
            fieldType: field.type,
            selectedOptions,
          };
        })
        .filter((f) => f.selectedOptions.length > 0);

      const extraPrice = customFieldsData.reduce(
        (sum, f) =>
          sum + f.selectedOptions.reduce((s, o) => s + o.price * o.quantity, 0),
        0,
      );

      await addDishToFlexBill(
        {
          restaurantId: branch.restaurant_id,
          branchNumber: branch.branch_number,
          tableNumber: parseTableNumber(order.identifier),
          item: selectedItem.name,
          quantity,
          price: basePrice,
          customFields: customFieldsData,
          extraPrice,
          menuItemId: selectedItem.id,
          specialInstructions: specialInstructions.trim() || null,
          guestName: guestName.trim(),
        },
        token,
      );

      onSuccess();
    } catch {
      setSubmitError("No se pudo agregar el platillo. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  const stepTitles = [
    "Agregar platillo",
    selectedItem?.name ?? "Personalizar",
    "Confirmar",
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col border border-white/10 shadow-2xl"
        style={{ background: "#071e22", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8 shrink-0"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">
              {order.identifier}
            </p>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep((s) => s - 1)}
                  className="text-white/40 hover:text-white transition-colors text-sm cursor-pointer"
                >
                  ←
                </button>
              )}
              <h2 className="text-white font-bold text-xl leading-none">
                {stepTitles[step]}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-white/30 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 0 — Select dish */}
        {step === 0 && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Section pills */}
            <div className="flex gap-2 px-5 py-3 overflow-x-auto shrink-0 no-scrollbar">
              {loadingMenu ? (
                <div className="h-7 w-24 rounded-full bg-white/10 animate-pulse" />
              ) : (
                sections.map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => setSelectedSection(sec.id)}
                    className={`shrink-0 text-xs px-4 py-1.5 rounded-full font-medium transition-colors cursor-pointer border ${
                      selectedSection === sec.id
                        ? "bg-teal-600 border-teal-500 text-white"
                        : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/70"
                    }`}
                  >
                    {sec.name}
                  </button>
                ))
              )}
            </div>

            {/* Item list */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-2">
              {loadingMenu ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-2xl bg-white/5 animate-pulse"
                  />
                ))
              ) : visibleItems.length === 0 ? (
                <p className="text-white/30 text-sm text-center mt-8">
                  Sin platillos en esta sección
                </p>
              ) : (
                <div
                  className="rounded-2xl border border-white/8 overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  {visibleItems.map((item, idx) => (
                    <button
                      key={item.id}
                      onClick={() => selectItem(item)}
                      className={`w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors cursor-pointer text-left ${
                        idx > 0 ? "border-t border-white/8" : ""
                      }`}
                    >
                      <p className="text-sm text-white/80">{item.name}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm text-white/40">
                          $
                          {item.discount > 0
                            ? (item.price * (1 - item.discount / 100)).toFixed(
                                2,
                              )
                            : item.price.toFixed(2)}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-white/20" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 1 — Customize */}
        {step === 1 && selectedItem && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              {/* Quantity */}
              <div
                className="rounded-2xl border border-white/8 px-4 py-3 flex items-center justify-between"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <span className="text-sm text-white/60">Cantidad</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    className="w-8 h-8 flex items-center justify-center rounded-full border border-white/15 text-white/60 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-base font-semibold text-white w-5 text-center">
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="w-8 h-8 flex items-center justify-center rounded-full border border-white/15 text-white/60 hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Custom fields */}
              {(selectedItem.custom_fields ?? []).map((field) => (
                <div
                  key={field.id}
                  className="rounded-2xl border border-white/8 overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-widest text-white/30 font-medium">
                      {field.name}
                    </span>
                    {field.type === "dropdown" && field.required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/25 text-amber-300">
                        Requerido
                      </span>
                    )}
                    {field.type === "checkboxes" && (
                      <span className="text-[10px] text-white/30">
                        Hasta {field.maxSelections ?? 1}
                      </span>
                    )}
                  </div>

                  {/* dropdown → radio */}
                  {field.type === "dropdown" && field.options && (
                    <>
                      {field.options.map((opt) => {
                        const sel =
                          (customSelections[field.id] as
                            | string[]
                            | undefined) ?? [];
                        const isSelected = sel.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            onClick={() =>
                              handleDropdownChange(field.id, opt.id)
                            }
                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer border-t border-white/8 ${
                              isSelected ? "bg-teal-600/15" : "hover:bg-white/5"
                            }`}
                          >
                            <div>
                              <span
                                className={`text-sm ${isSelected ? "text-white" : "text-white/70"}`}
                              >
                                {opt.name}
                              </span>
                              {opt.price > 0 && (
                                <span className="text-xs text-teal-400 ml-2">
                                  +${opt.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div
                              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? "border-teal-400"
                                  : "border-white/20"
                              }`}
                            >
                              {isSelected && (
                                <div className="w-2 h-2 rounded-full bg-teal-400" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* checkboxes */}
                  {field.type === "checkboxes" && field.options && (
                    <>
                      {field.options.map((opt) => {
                        const sel =
                          (customSelections[field.id] as string[]) ?? [];
                        const isSelected = sel.includes(opt.id);
                        const isDisabled =
                          !isSelected &&
                          sel.length >= (field.maxSelections ?? 1);
                        return (
                          <button
                            key={opt.id}
                            onClick={() =>
                              !isDisabled &&
                              handleCheckboxChange(field.id, opt.id, field)
                            }
                            disabled={isDisabled}
                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40 border-t border-white/8 ${
                              isSelected ? "bg-teal-600/15" : "hover:bg-white/5"
                            }`}
                          >
                            <div>
                              <span
                                className={`text-sm ${isSelected ? "text-white" : "text-white/70"}`}
                              >
                                {opt.name}
                              </span>
                              {opt.price > 0 && (
                                <span className="text-xs text-teal-400 ml-2">
                                  +${opt.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? "border-teal-400 bg-teal-600"
                                  : "border-white/20"
                              }`}
                            >
                              {isSelected && (
                                <svg
                                  className="w-2.5 h-2.5 text-white"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                  strokeWidth={3}
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {/* dropdown-quantity */}
                  {field.type === "dropdown-quantity" && field.options && (
                    <>
                      {field.options.map((opt) => {
                        const sel = customSelections[field.id];
                        const qty =
                          sel && typeof sel === "object" && !Array.isArray(sel)
                            ? ((sel as Record<string, number>)[opt.id] ?? 0)
                            : 0;
                        return (
                          <div
                            key={opt.id}
                            className="flex items-center justify-between px-4 py-3 border-t border-white/8"
                          >
                            <div>
                              <span className="text-sm text-white/70">
                                {opt.name}
                              </span>
                              {opt.price > 0 && (
                                <span className="text-xs text-teal-400 ml-2">
                                  +${opt.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() =>
                                  handleQuantityChange(
                                    field.id,
                                    opt.id,
                                    Math.max(0, qty - 1),
                                  )
                                }
                                disabled={qty <= 0}
                                className="w-7 h-7 flex items-center justify-center rounded-full border border-white/15 text-white/50 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-sm font-medium text-white w-4 text-center">
                                {qty}
                              </span>
                              <button
                                onClick={() =>
                                  handleQuantityChange(
                                    field.id,
                                    opt.id,
                                    qty + 1,
                                  )
                                }
                                className="w-7 h-7 flex items-center justify-center rounded-full border border-white/15 text-white/50 hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ))}

              {/* Special instructions */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-widest text-white/30 font-medium">
                  Instrucciones especiales
                </label>
                <textarea
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  maxLength={60}
                  placeholder="Alergias, sin sal, bien cocido..."
                  rows={2}
                  className="w-full rounded-2xl border border-white/8 px-4 py-3 text-sm text-white/80 placeholder-white/20 resize-none focus:outline-none focus:border-white/20"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                />
                <p className="text-right text-[10px] text-white/20">
                  {specialInstructions.length}/60
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-6 pt-3 border-t border-white/8 shrink-0">
              <button
                onClick={() => setStep(2)}
                disabled={!isFormValid}
                className="w-full py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
              >
                Continuar · ${totalPrice.toFixed(2)}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Guest name + confirm */}
        {step === 2 && selectedItem && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              {/* Summary card */}
              <div
                className="rounded-2xl border border-white/8 px-4 py-4"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-white/80 font-semibold text-sm">
                    {selectedItem.name}
                  </p>
                  <p className="text-white font-bold text-lg">
                    ${totalPrice.toFixed(2)}
                  </p>
                </div>
                {(() => {
                  const customText = Object.entries(customSelections)
                    .flatMap(([fieldId, sel]) => {
                      const field = selectedItem.custom_fields?.find(
                        (f) => f.id === fieldId,
                      );
                      if (!field) return [];
                      if (Array.isArray(sel)) {
                        return sel
                          .map(
                            (optId) =>
                              field.options?.find((o) => o.id === optId)
                                ?.name ?? "",
                          )
                          .filter(Boolean);
                      }
                      if (typeof sel === "object") {
                        return Object.entries(sel as Record<string, number>)
                          .filter(([, q]) => q > 0)
                          .map(([optId, q]) => {
                            const name = field.options?.find(
                              (o) => o.id === optId,
                            )?.name;
                            return name ? `${name} ×${q}` : "";
                          })
                          .filter(Boolean);
                      }
                      return [];
                    })
                    .join(", ");
                  const prefix = quantity > 1 ? `${quantity}× · ` : "";
                  const line = prefix + customText;
                  return line ? (
                    <p className="text-xs text-white/40 leading-relaxed">
                      {line}
                    </p>
                  ) : null;
                })()}
                {specialInstructions && (
                  <p className="text-xs text-white/30 italic mt-1">
                    "{specialInstructions}"
                  </p>
                )}
              </div>

              {/* Guest name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-widest text-white/30 font-medium">
                  Nombre del comensal{" "}
                  <span className="text-amber-400 normal-case">*</span>
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Ej. Ana, silla 2..."
                  className="w-full rounded-2xl border border-white/8 px-4 py-3 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-white/20"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                  autoFocus
                />
              </div>

              {submitError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-400/20 rounded-2xl px-4 py-3 text-center">
                  {submitError}
                </p>
              )}
            </div>

            <div className="px-5 pb-6 pt-3 border-t border-white/8 shrink-0 flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="px-5 py-3 rounded-2xl border border-white/15 text-white/60 text-sm font-medium hover:bg-white/5 transition-colors cursor-pointer"
              >
                Atrás
              </button>
              <button
                onClick={handleConfirm}
                disabled={!guestName.trim() || submitting}
                className="flex-1 py-3 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition-colors cursor-pointer disabled:cursor-default disabled:opacity-40"
              >
                {submitting ? "Agregando..." : "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
