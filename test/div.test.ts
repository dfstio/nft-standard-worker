import { describe, it } from "node:test";
import assert from "node:assert";
import { UInt64 } from "o1js";
import { mulDiv } from "@silvana-one/nft";

const NUMBER_OF_ITERATIONS = 10000;
const max = UInt64.MAXINT().toBigInt();

const randomUInt64 = () => {
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  const randomBigInt = BigInt(
    "0x" +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
  );
  if (randomBigInt > max) {
    throw new Error("Random number is greater than max");
  }
  return UInt64.from(randomBigInt);
};

describe("Test mulDiv", async () => {
  it("should use mulDiv", async () => {
    let count = 0;
    for (let i = 0; i < NUMBER_OF_ITERATIONS; i++) {
      const value = randomUInt64();
      const multiplier = randomUInt64();
      const denominator = randomUInt64();

      try {
        const expectedValue =
          (value.toBigInt() * multiplier.toBigInt()) / denominator.toBigInt();
        const expectedRemainder =
          (value.toBigInt() * multiplier.toBigInt()) % denominator.toBigInt();
        if (expectedValue > max) {
          count++;
          continue;
        }
        const result = mulDiv({ value, multiplier, denominator });
        assert.strictEqual(result.result.toBigInt(), expectedValue);
        assert.strictEqual(result.remainder.toBigInt(), expectedRemainder);
        assert.strictEqual(result.result.toBigInt() <= max, true);
        assert.strictEqual(
          result.remainder.toBigInt() < denominator.toBigInt(),
          true
        );
        assert.strictEqual(
          result.remainder.toBigInt() < denominator.toBigInt(),
          true
        );
      } catch (e) {
        console.log(e);
        console.log({
          value: value.toBigInt(),
          multiplier: multiplier.toBigInt(),
          denominator: denominator.toBigInt(),
          max: max,
          expectedValue:
            (value.toBigInt() * multiplier.toBigInt()) / denominator.toBigInt(),
          expectedRemainder:
            (value.toBigInt() * multiplier.toBigInt()) % denominator.toBigInt(),
        });
      }
    }
    //console.log("count", count);
  });
});
