export interface CommissionRates {
  evenTotal: number;
  clientPays: number;
  restaurantPays: number;
}

export interface CommissionBreakdown {
  baseAmount: number;
  tipAmount: number;
  ivaTip: number;
  subtotalForCommission: number;
  evenCommissionTotal: number;
  evenCommissionClient: number;
  evenCommissionRestaurant: number;
  ivaEvenTotal: number;
  ivaEvenClient: number;
  ivaEvenRestaurant: number;
  evenClientCharge: number;
  evenRestaurantCharge: number;
  totalAmountCharged: number;
  even_rate_applied: number;
  rates: CommissionRates;
}

export function getCommissionRates(amount: number): CommissionRates {
  if (amount >= 20 && amount <= 30) {
    return { evenTotal: 11.0, clientPays: 9.0, restaurantPays: 2.0 };
  } else if (amount >= 31 && amount <= 49) {
    return { evenTotal: 8.0, clientPays: 6.0, restaurantPays: 2.0 };
  } else if (amount >= 50 && amount <= 100) {
    return { evenTotal: 5.8, clientPays: 3.8, restaurantPays: 2.0 };
  } else if (amount >= 101 && amount <= 150) {
    return { evenTotal: 4.2, clientPays: 2.2, restaurantPays: 2.0 };
  } else if (amount > 150) {
    return { evenTotal: 4.0, clientPays: 2.0, restaurantPays: 2.0 };
  } else {
    return { evenTotal: 11.0, clientPays: 9.0, restaurantPays: 2.0 };
  }
}

export function calculateCommissions(
  baseAmount: number,
  tipAmount: number,
): CommissionBreakdown {
  const ivaTip = tipAmount * 0.16;
  const subtotalForCommission = baseAmount + tipAmount;
  const rates = getCommissionRates(subtotalForCommission);

  const evenCommissionTotal = subtotalForCommission * (rates.evenTotal / 100);
  const evenCommissionClient = subtotalForCommission * (rates.clientPays / 100);
  const evenCommissionRestaurant = subtotalForCommission * (rates.restaurantPays / 100);

  const ivaEvenTotal = evenCommissionTotal * 0.16;
  const ivaEvenClient = evenCommissionClient * 0.16;
  const ivaEvenRestaurant = evenCommissionRestaurant * 0.16;

  const r2 = (n: number) => Math.round(n * 100) / 100;

  const evenClientCharge = r2(evenCommissionClient + ivaEvenClient);
  const evenRestaurantCharge = r2(evenCommissionRestaurant + ivaEvenRestaurant);

  const totalAmountCharged = r2(baseAmount + tipAmount + evenClientCharge);

  const even_rate_applied =
    subtotalForCommission > 0
      ? r2((evenCommissionTotal / subtotalForCommission) * 100)
      : 0;

  return {
    baseAmount,
    tipAmount,
    ivaTip,
    subtotalForCommission,
    evenCommissionTotal,
    evenCommissionClient,
    evenCommissionRestaurant,
    ivaEvenTotal,
    ivaEvenClient,
    ivaEvenRestaurant,
    evenClientCharge,
    evenRestaurantCharge,
    totalAmountCharged,
    even_rate_applied,
    rates,
  };
}
