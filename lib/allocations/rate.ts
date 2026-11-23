// What a client's allocated hours are worth.
//
// Two numbers, both from the monthly amount on the contract and the hours we
// plan for the month:
//   real rate  = monthly amount / allocated hours   (what we actually earn per hour)
//   at target  = allocated hours x the target rate  (what those hours should bill)
//
// The target rate is one number for the whole company. It is $150 today;
// change it here (or set TARGET_BILL_RATE on the server) and every screen
// follows.

export const TARGET_BILL_RATE = Number(process.env.TARGET_BILL_RATE) > 0 ? Number(process.env.TARGET_BILL_RATE) : 150;

export type RateMath = {
  monthly: number | null;
  hours: number | null;
  target: number;
  realRate: number | null; // monthly / hours
  atTarget: number | null; // hours x target
  gap: number | null; // monthly - atTarget: negative = more hours allocated than the amount covers
  budgetHours: number | null; // monthly / target: the hours the amount buys at the target rate
};

export function rateMath(monthly: number | null | undefined, hours: number | null | undefined, target: number = TARGET_BILL_RATE): RateMath {
  const m = typeof monthly === "number" && monthly > 0 ? monthly : null;
  const h = typeof hours === "number" && hours > 0 ? hours : null;
  const atTarget = h != null ? h * target : null;
  return {
    monthly: m,
    hours: h,
    target,
    realRate: m != null && h != null ? m / h : null,
    atTarget,
    gap: m != null && atTarget != null ? m - atTarget : null,
    budgetHours: m != null ? m / target : null,
  };
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
export const signedMoney = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** How a real rate compares with the target: at or above, a little under, well under. */
export function rateTone(realRate: number | null, target: number = TARGET_BILL_RATE): "good" | "watch" | "low" | null {
  if (realRate == null) return null;
  if (realRate >= target) return "good";
  return realRate >= target * 0.8 ? "watch" : "low";
}
