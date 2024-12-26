import { describe, it } from "node:test";
import { compileContracts } from "./helpers/compile.js";

describe("Contracts verification keys on mainnet", async () => {
  await compileContracts("mainnet");
});
