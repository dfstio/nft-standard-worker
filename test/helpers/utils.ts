import { blockchain } from "zkcloudworker";

export function processArguments(): {
  chain: blockchain;
  proofsEnabled: boolean;
  useWhitelistedAdmin: boolean;
} {
  const chainName = process.env.CHAIN ?? "local";
  const proofs = process.env.PROOFS ?? "true";
  const useWhitelistedAdmin = process.env.WHITELIST ?? "false";
  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");

  return {
    chain: chainName as blockchain,
    proofsEnabled: proofs === "true",
    useWhitelistedAdmin: useWhitelistedAdmin === "true",
  };
}
