import { blockchain } from "zkcloudworker";

export function processArguments(): {
  chain: blockchain;
  useAdvancedAdmin: boolean;
  withdraw: boolean;
  noLog: boolean;
  approveTransfer: boolean;
  shares: boolean;
} {
  const chainName = process.env.CHAIN ?? "local";
  const useAdvancedAdmin = process.env.ADVANCED ?? "false";
  const withdraw = process.env.WITHDRAW ?? "false";
  const noLog = process.env.NO_LOG ?? "false";
  const approveTransfer = process.env.APPROVE_TRANSFER ?? "false";
  const shares = process.env.SHARES ?? "false";
  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");

  return {
    chain: chainName as blockchain,
    useAdvancedAdmin: useAdvancedAdmin === "true",
    withdraw: withdraw === "true",
    noLog: noLog === "true",
    approveTransfer: approveTransfer === "true",
    shares: shares === "true",
  };
}
