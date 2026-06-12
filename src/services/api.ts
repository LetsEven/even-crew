import type { Order, TableSummary, DishOrderCrew } from "../types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function authFetch(
  url: string,
  token: string,
  options: RequestInit = {},
) {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getActiveOrders(
  token: string,
  branchId?: string | null,
): Promise<Order[]> {
  const url = branchId
    ? `/api/kitchen/orders?branchId=${branchId}`
    : "/api/kitchen/orders";
  const data = await authFetch(url, token);
  return data.orders ?? [];
}

export async function getOrderHistory(
  token: string,
  branchId?: string | null,
  since?: string | null,
  until?: string | null,
): Promise<Order[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", branchId);
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  const qs = params.toString();
  const data = await authFetch(
    `/api/kitchen/orders/history${qs ? `?${qs}` : ""}`,
    token,
  );
  return data.orders ?? [];
}

export async function getAvailableMonths(
  token: string,
  branchId?: string | null,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", branchId);
  const qs = params.toString();
  const data = await authFetch(
    `/api/kitchen/orders/history/available-months${qs ? `?${qs}` : ""}`,
    token,
  );
  return data.months ?? [];
}

export async function updateDishStatus(
  dishId: string,
  orderType: string,
  status: string,
  token: string,
) {
  if (orderType === "tap_pay") {
    return authFetch(`/api/tap-pay/dishes/${dishId}/status`, token, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }
  if (orderType === "pick_and_go") {
    return authFetch(`/api/pick-and-go/dishes/${dishId}/status`, token, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  }
  // tap, room, flex_bill → dish-orders endpoint
  return authFetch(`/api/dish-orders/${dishId}/status`, token, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function updatePickAndGoOrderCookingStatus(
  orderId: string,
  status: string,
  token: string,
) {
  return authFetch(`/api/pick-and-go/orders/${orderId}/cooking-status`, token, {
    method: "PUT",
    body: JSON.stringify({ cooking_status: status }),
  });
}

export async function saveFcmToken(
  token: string,
  fcmToken: string,
  platform: string,
) {
  return authFetch("/api/kitchen/fcm-token", token, {
    method: "POST",
    body: JSON.stringify({ token: fcmToken, platform }),
  });
}

export async function deleteFcmToken(token: string, fcmToken: string) {
  return authFetch("/api/kitchen/fcm-token", token, {
    method: "DELETE",
    body: JSON.stringify({ token: fcmToken }),
  });
}

export interface Branch {
  id: string;
  name: string;
  branch_number: number;
  restaurant_id: number;
  max_pending_orders?: number | null;
  tap_pay_print?: boolean;
}

export async function getBranches(token: string): Promise<Branch[]> {
  const data = await authFetch("/api/kitchen/branches", token);
  return data.branches ?? [];
}

export interface PrinterRecord {
  id: string;
  branch_id: string;
  ip: string | null;
  port: number | null;
  name: string | null;
  role: "bar" | "kitchen" | "other" | "all" | null;
  is_active: boolean;
  last_seen_at: string | null;
  connection_type: "wifi" | "usb";
  usb_device_name: string | null;
}

export async function getPrinters(branchId: string): Promise<PrinterRecord[]> {
  const res = await fetch(`${BASE_URL}/api/pos/branch/${branchId}/printers`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.printers ?? [];
}

export async function syncPrinters(
  token: string,
  branchId: string,
  printers: (
    | { ip: string; port: number; connection_type?: "wifi" }
    | {
        usb_device_name: string;
        vendor_id?: number;
        product_id?: number;
        connection_type: "usb";
      }
  )[],
): Promise<PrinterRecord[]> {
  const data = await authFetch("/api/kitchen/printers/sync", token, {
    method: "POST",
    body: JSON.stringify({ branchId, printers }),
  });
  return data.printers ?? [];
}

export async function getTableSummary(
  restaurantId: string,
  branchNumber: string,
  tableNumber: string,
  token: string,
): Promise<TableSummary | null> {
  const data = await authFetch(
    `/api/restaurants/${restaurantId}/branches/${branchNumber}/tables/${tableNumber}/summary`,
    token,
  );
  return data.data ?? data.summary ?? null;
}

export async function getDishOrders(
  restaurantId: string,
  branchNumber: string,
  tableNumber: string,
  token: string,
): Promise<DishOrderCrew[]> {
  const data = await authFetch(
    `/api/restaurants/${restaurantId}/branches/${branchNumber}/tables/${tableNumber}/orders`,
    token,
  );
  return data.data ?? data.dishOrders ?? data.orders ?? [];
}

export interface PayTableManualParams {
  restaurantId: string;
  branchNumber: string;
  tableNumber: string;
  amount: number;
  guestName: string;
}

export async function payTableManual(
  params: PayTableManualParams,
  token: string,
): Promise<void> {
  const { restaurantId, branchNumber, tableNumber, amount, guestName } = params;
  await authFetch(
    `/api/restaurants/${restaurantId}/branches/${branchNumber}/tables/${tableNumber}/pay`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        amount,
        paymentMethodId: null,
        guestName,
        userId: null,
      }),
    },
  );
}

export async function payDishOrderManual(
  dishId: string,
  guestName: string,
  token: string,
  restaurantId?: string,
  branchNumber?: string,
  tableNumber?: string,
): Promise<void> {
  await authFetch(`/api/dishes/${dishId}/pay`, token, {
    method: "POST",
    body: JSON.stringify({
      paymentMethodId: null,
      guestName,
      restaurantId: restaurantId ?? undefined,
      branchNumber: branchNumber ?? undefined,
      tableNumber: tableNumber ?? undefined,
    }),
  });
}

export async function syncTapPayOrderFromPOS(
  orderId: string,
  token: string,
): Promise<void> {
  await authFetch(`/api/tap-pay/orders/${orderId}/sync-from-pos`, token, {
    method: "POST",
  });
}

export async function payTapPayDishOrder(
  dishId: string,
  guestName: string,
  token: string,
  tipAmount?: number,
  paymentSource?: string,
): Promise<void> {
  await authFetch(`/api/tap-pay/dishes/${dishId}/pay`, token, {
    method: "POST",
    body: JSON.stringify({
      guestName,
      tipAmount: tipAmount ?? 0,
      paymentSource: paymentSource ?? null,
    }),
  });
}

export async function payTapPayOrderAmount(
  orderId: string,
  amount: number,
  guestName: string,
  token: string,
  tipAmount?: number,
  paymentSource?: string,
): Promise<void> {
  await authFetch(`/api/tap-pay/orders/${orderId}/pay-amount`, token, {
    method: "POST",
    body: JSON.stringify({
      amount,
      guestName,
      tipAmount: tipAmount ?? 0,
      paymentSource: paymentSource ?? null,
    }),
  });
}

export interface CreateManualTransactionParams {
  id_table_order?: string;
  id_tap_pay_order?: string;
  restaurant_id: number;
  base_amount: number;
  tip_amount: number;
  iva_tip: number;
  total_amount_charged: number;
  subtotal_for_commission: number;
  even_commission_total: number;
  even_commission_client: number;
  even_commission_restaurant: number;
  iva_even_client: number;
  iva_even_restaurant: number;
  even_client_charge: number;
  even_restaurant_charge: number;
  even_rate_applied: number;
  transaction_by: string;
  payment_source: "cash" | "terminal";
  manual_reference: string | null;
  currency?: string;
}

export interface TableRow {
  id: string;
  table_number: number;
  status: "available" | "occupied" | "maintenance";
  has_open_account: boolean;
  has_tap_pay_account?: boolean;
}

export interface QRCodeRow {
  id: string;
  code: string;
  table_number: number;
  service: string;
}

export interface TableDish {
  item: string;
  quantity: number;
  status: string;
  payment_status?: string;
}

export interface TablePayment {
  guestName: string | null;
  baseAmount: number;
  tipAmount: number;
  cardType: string | null;
}

export interface TableActiveSummary {
  service: string;
  label: string;
  total: number;
  status: string;
  folio?: string | number | null;
  paid_amount?: number;
  remaining_amount?: number;
  dishes?: TableDish[];
  payments?: TablePayment[];
}

export async function getTablesForBranch(
  branchId: string,
  token: string,
): Promise<TableRow[]> {
  const data = await authFetch(
    `/api/kitchen/tables?branchId=${branchId}`,
    token,
  );
  return data.tables ?? [];
}

export async function getQRCodesForBranch(
  branchId: string,
  token: string,
): Promise<QRCodeRow[]> {
  const data = await authFetch(
    `/api/kitchen/branches/${branchId}/qr-codes`,
    token,
  );
  return data.qrCodes ?? [];
}

export async function checkTablePOS(
  branchId: string,
  tableNumber: number,
  token: string,
): Promise<TableActiveSummary | null> {
  const data = await authFetch(
    `/api/kitchen/tables/${tableNumber}/pos-check?branchId=${branchId}`,
    token,
  );
  return data.order ?? null;
}

export async function peekTablePOS(
  branchId: string,
  tableNumber: number,
  token: string,
): Promise<boolean> {
  const data = await authFetch(
    `/api/kitchen/tables/${tableNumber}/pos-peek?branchId=${branchId}`,
    token,
  );
  return data.hasPOSOrder === true;
}

export async function openTableAccount(
  branchId: string,
  tableNumber: number,
  token: string,
): Promise<TableActiveSummary | null> {
  const data = await authFetch(
    `/api/kitchen/tables/${tableNumber}/open?branchId=${branchId}`,
    token,
    { method: "POST" },
  );
  return data.order ?? null;
}

export async function getTableActiveSummary(
  branchId: string,
  tableNumber: number,
  token: string,
): Promise<TableActiveSummary | null> {
  const data = await authFetch(
    `/api/kitchen/tables/${tableNumber}/summary?branchId=${branchId}`,
    token,
  );
  return data.order ?? null;
}

export async function createManualTransaction(
  params: CreateManualTransactionParams,
  token: string,
): Promise<void> {
  await authFetch("/api/payment-transactions", token, {
    method: "POST",
    body: JSON.stringify({
      payment_method_id: null,
      restaurant_id: params.restaurant_id,
      ...(params.id_table_order
        ? { id_table_order: params.id_table_order }
        : {}),
      ...(params.id_tap_pay_order
        ? { id_tap_pay_order: params.id_tap_pay_order }
        : {}),
      base_amount: params.base_amount,
      tip_amount: params.tip_amount,
      iva_tip: params.iva_tip,
      even_commission_total: params.even_commission_total,
      even_commission_client: params.even_commission_client,
      even_commission_restaurant: params.even_commission_restaurant,
      iva_even_client: params.iva_even_client,
      iva_even_restaurant: params.iva_even_restaurant,
      even_client_charge: params.even_client_charge,
      even_restaurant_charge: params.even_restaurant_charge,
      even_rate_applied: params.even_rate_applied,
      total_amount_charged: params.total_amount_charged,
      subtotal_for_commission: params.subtotal_for_commission,
      currency: params.currency ?? "MXN",
      transaction_by: params.transaction_by,
      payment_source: params.payment_source,
      manual_reference: params.manual_reference,
      ecartpay_order_id: null,
    }),
  });
}

export async function updatePrinter(
  token: string,
  printerId: string,
  updates: { name?: string; role?: string; is_active?: boolean },
): Promise<PrinterRecord> {
  const data = await authFetch(`/api/kitchen/printers/${printerId}`, token, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return data.printer;
}

export async function deletePrinter(
  token: string,
  printerId: string,
): Promise<void> {
  await authFetch(`/api/kitchen/printers/${printerId}`, token, {
    method: "DELETE",
  });
}

export interface MenuItemOption {
  id: string;
  name: string;
  price: number;
}

export interface MenuItemCustomField {
  id: string;
  name: string;
  type: string;
  options?: MenuItemOption[];
  required?: boolean;
  maxSelections?: number;
}

export interface MenuItem {
  id: number;
  name: string;
  price: number;
  discount: number;
  custom_fields: MenuItemCustomField[];
  is_available: boolean;
  is_out_of_stock?: boolean;
  section_id: number;
}

export interface MenuSection {
  id: number;
  name: string;
  is_active: boolean;
  display_order: number;
  items: MenuItem[];
}

export interface AddDishParams {
  restaurantId: number;
  branchNumber: number;
  tableNumber: number;
  item: string;
  quantity: number;
  price: number;
  customFields: Array<{
    fieldId: string;
    fieldName: string;
    fieldType: string;
    selectedOptions: Array<{
      optionId: string;
      optionName: string;
      price: number;
      quantity: number;
    }>;
  }>;
  extraPrice: number;
  menuItemId: number;
  specialInstructions: string | null;
  guestName: string;
}

export async function getRestaurantMenu(
  restaurantId: number,
  branchNumber: number,
  token: string,
): Promise<MenuSection[]> {
  const data = await authFetch(
    `/api/restaurants/${restaurantId}/${branchNumber}/complete`,
    token,
  );
  return data.data?.menu ?? [];
}

export async function addDishToFlexBill(
  params: AddDishParams,
  token: string,
): Promise<void> {
  await authFetch(
    `/api/restaurants/${params.restaurantId}/branches/${params.branchNumber}/tables/${params.tableNumber}/dishes`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        item: params.item,
        quantity: params.quantity,
        price: params.price,
        customFields: params.customFields,
        extraPrice: params.extraPrice,
        menuItemId: params.menuItemId,
        specialInstructions: params.specialInstructions,
        guestName: params.guestName,
      }),
    },
  );
}
