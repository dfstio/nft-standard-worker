import { blockchain } from "zkcloudworker";

export function processArguments(): {
  chain: blockchain;
  proofsEnabled: boolean;
  useAdvancedAdmin: boolean;
} {
  const chainName = process.env.CHAIN ?? "local";
  const proofs = process.env.PROOFS ?? "true";
  const useAdvancedAdmin = process.env.ADVANCED ?? "false";
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
    useAdvancedAdmin: useAdvancedAdmin === "true",
  };
}
