export type DishStatus = "preparing" | "ready" | "delivered";

export type CookingStatus = "preparing" | "ready" | "delivered";

export type OrderType = "tap" | "pick_and_go" | "room" | "tap_pay" | "flex_bill";

export interface CustomFieldOption {
  optionId: string;
  optionName: string;
  price: number;
  quantity: number;
}

export interface CustomField {
  fieldId: string;
  fieldName: string;
  fieldType: string;
  selectedOptions?: CustomFieldOption[];
}

export interface Dish {
  id: string;
  item: string;
  quantity: number;
  status: DishStatus;
  images: string[];
  orderedBy?: string | null;
  userFolio?: string | null;
  customFields?: CustomField[] | null;
  specialInstructions?: string | null;
  price?: number;
  paymentStatus?: string;
}

export interface PaymentTransaction {
  id: string;
  baseAmount: number;
  tipAmount: number;
  totalCharged: number;
  cardType: string;
  createdAt: string;
  guestName?: string | null;
}

export type ManualPaymentMethod = "cash" | "terminal";
export type ManualPaymentType =
  | "full-bill"
  | "select-items"
  | "equal-shares"
  | "choose-amount";

export interface TableSummary {
  table_number: number;
  table_order_id: string;
  restaurant_id: number;
  branch_number: number;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: "not_paid" | "partial" | "paid";
}

export interface DishOrderCrew {
  dish_order_id: string;
  item: string;
  quantity: number;
  price: number;
  total_price: number;
  payment_status: "not_paid" | "paid";
  guest_name: string;
}

export interface Order {
  id: string;
  orderType: OrderType;
  identifier: string;
  customerName?: string | null;
  createdAt: string;
  folio?: string | number | null;
  orderNotes?: string | null;
  status?: string | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  remainingAmount?: number | null;
  payments?: PaymentTransaction[];
  dishes: Dish[];
  cookingStatus?: CookingStatus;
}
