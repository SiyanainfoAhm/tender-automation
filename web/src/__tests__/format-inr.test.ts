import { describe, expect, it } from "vitest";

import {
  formatEmdAmount,
  formatInrCompactAmount,
  formatTenderValue,
} from "@/lib/format-inr";
import { formatIndianCurrency } from "@/lib/format";

describe("formatInrCompactAmount", () => {
  it("formats crores with unit", () => {
    expect(formatInrCompactAmount(62_000_000)).toBe("₹6.20 Cr");
    expect(formatInrCompactAmount(50_000_000)).toBe("₹5.00 Cr");
  });

  it("formats lakhs with L unit", () => {
    expect(formatInrCompactAmount(1_500_000)).toBe("₹15.00 L");
    expect(formatInrCompactAmount(120_000)).toBe("₹1.20 L");
    expect(formatInrCompactAmount(250_000)).toBe("₹2.50 L");
  });

  it("formats thousands without omitting scale", () => {
    expect(formatInrCompactAmount(75_000)).toBe("₹75,000");
    expect(formatInrCompactAmount(8_500)).toBe("₹8,500");
  });

  it("formats zero distinctly from null", () => {
    expect(formatInrCompactAmount(0)).toBe("₹0");
    expect(formatInrCompactAmount(null)).toBeNull();
    expect(formatInrCompactAmount(undefined)).toBeNull();
    expect(formatInrCompactAmount(Number.NaN)).toBeNull();
  });

  it("never returns a bare rupee amount without Cr/L in crore/lakh ranges", () => {
    const crore = formatInrCompactAmount(62_000_000)!;
    expect(crore).toContain("Cr");
    expect(crore).not.toBe("₹6.2");

    const lakh = formatInrCompactAmount(450_000)!;
    expect(lakh).toContain("L");
    expect(lakh).not.toBe("₹4.5");
  });
});

describe("formatTenderValue", () => {
  it("prefers numeric amount", () => {
    const display = formatTenderValue({ amount: 62_000_000, text: "Refer Documents" });
    expect(display.label).toBe("₹6.20 Cr");
    expect(display.tooltip).toBe("₹6,20,00,000");
    expect(display.isNumeric).toBe(true);
  });

  it("uses BidAssist source text when numeric is null", () => {
    expect(
      formatTenderValue({ amount: null, text: "Refer Documents" }).label,
    ).toBe("Refer documents");
    expect(
      formatTenderValue({ amount: null, text: "Not Disclosed" }).label,
    ).toBe("Not disclosed");
    expect(
      formatTenderValue({ amount: null, text: "As per RFP" }).label,
    ).toBe("As per RFP");
  });

  it("does not convert refer/not disclosed text into ₹0", () => {
    const display = formatTenderValue({
      amount: null,
      text: "Refer Documents",
    });
    expect(display.label).not.toMatch(/₹0/);
    expect(display.isNumeric).toBe(false);
  });

  it("shows Not disclosed when both missing", () => {
    expect(formatTenderValue({ amount: null, text: null }).label).toBe(
      "Not disclosed",
    );
    expect(formatTenderValue({}).label).toBe("Not disclosed");
  });
});

describe("formatEmdAmount", () => {
  it("formats numeric EMD", () => {
    expect(formatEmdAmount({ amount: 120_000 }).label).toBe("₹1.20 L");
    expect(formatEmdAmount({ amount: 1_500_000 }).label).toBe("₹15.00 L");
    expect(formatEmdAmount({ amount: 50_000 }).label).toBe("₹50,000");
  });

  it("uses source text when numeric is null", () => {
    expect(formatEmdAmount({ amount: null, text: "Not Required" }).label).toBe(
      "Not required",
    );
    expect(formatEmdAmount({ amount: null, text: "Nil" }).label).toBe("Nil");
    expect(formatEmdAmount({ amount: null, text: "Exempted" }).label).toBe(
      "Exempted",
    );
  });

  it("treats null EMD as Not disclosed, not ₹0", () => {
    const display = formatEmdAmount({ amount: null, text: null });
    expect(display.label).toBe("Not disclosed");
    expect(formatEmdAmount({ amount: 0 }).label).toBe("₹0");
  });
});

describe("formatIndianCurrency compatibility", () => {
  it("uses compact Cr/L labels and dash for null", () => {
    expect(formatIndianCurrency(48_600_000)).toBe("₹4.86 Cr");
    expect(formatIndianCurrency(561_000)).toBe("₹5.61 L");
    expect(formatIndianCurrency(null)).toBe("—");
  });
});
