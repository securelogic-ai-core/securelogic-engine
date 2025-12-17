export interface ProductSKU {
  name: string;
  priceRangeUSD: [number, number];
  intendedBuyer: string;
  deliverables: string[];
}

export const PRODUCT_SKUS: Record<
  "Starter" | "Professional" | "Enterprise",
  ProductSKU
> = {
  Starter: {
    name: "Starter Risk Decision",
    priceRangeUSD: [499, 499],
    intendedBuyer: "Founders, early-stage teams",
    deliverables: [
      "Risk approval decision",
      "Overall risk severity"
    ]
  },
  Professional: {
    name: "Executive Risk Assessment",
    priceRangeUSD: [5000, 7500],
    intendedBuyer: "SMBs, compliance teams",
    deliverables: [
      "Executive risk report (PDF)",
      "Risk decision & rationale",
      "Remediation plan"
    ]
  },
  Enterprise: {
    name: "Enterprise Risk & Pricing Analysis",
    priceRangeUSD: [20000, 35000],
    intendedBuyer: "Enterprises, boards, regulators",
    deliverables: [
      "Executive risk report (PDF)",
      "Risk decision & rationale",
      "Remediation plan",
      "Pricing & complexity justification"
    ]
  }
};
