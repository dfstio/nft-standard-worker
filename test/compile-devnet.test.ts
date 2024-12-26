import { describe, it } from "node:test";
import { compileContracts } from "./helpers/compile.js";

describe("Contracts verification keys on devnet", async () => {
  await compileContracts("devnet");
});
