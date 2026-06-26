import { relativeDrift, runReconciliation } from "../services/reconciliation.js";

describe("reconciliation", () => {
  describe("relativeDrift", () => {
    it("is 0 for an exact match", () => {
      expect(relativeDrift(100, 100)).toBe(0);
    });

    it("computes relative difference against on-chain truth", () => {
      expect(relativeDrift(110, 100)).toBeCloseTo(0.1, 6);
      expect(relativeDrift(90, 100)).toBeCloseTo(0.1, 6);
    });

    it("guards against divide-by-zero", () => {
      // onchain 0, indexed small → large but finite drift (not NaN/Infinity)
      const d = relativeDrift(0.0001, 0);
      expect(Number.isFinite(d)).toBe(true);
    });

    it("treats two zeros as no drift", () => {
      expect(relativeDrift(0, 0)).toBe(0);
    });
  });

  describe("runReconciliation", () => {
    it("never throws and returns a result object", async () => {
      // With the global pg/ethers mocks (empty rows, no vault address resolved),
      // the run should complete gracefully without throwing.
      const result = await runReconciliation();
      expect(result).toHaveProperty("ran");
      expect(typeof result.ran).toBe("boolean");
    });
  });
});
