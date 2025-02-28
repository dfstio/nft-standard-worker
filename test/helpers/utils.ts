import { blockchain } from "zkcloudworker";

export function processArguments(): {
  chain: blockchain;
  useAdvancedAdmin: boolean;
  useLocalCloudWorker: boolean;
  withdraw: boolean;
  noLog: boolean;
  approveTransfer: boolean;
  shares: boolean;
  readOnly: boolean;
  deploy: boolean;
  mint: boolean;
  transfer: boolean;
  sell: boolean;
  buy: boolean;
} {
  const chainName = process.env.CHAIN ?? "local";
  const useAdvancedAdmin = process.env.ADVANCED ?? "false";
  const withdraw = process.env.WITHDRAW ?? "false";
  const noLog = process.env.NO_LOG ?? "false";
  const approveTransfer = process.env.APPROVE_TRANSFER ?? "false";
  const shares = process.env.SHARES ?? "false";
  const readOnly = process.env.READ_ONLY ?? "false";
  const useLocalCloudWorker = process.env.CLOUD === "local";
  const deploy = process.env.DEPLOY === "true";
  const mint = process.env.MINT === "true";
  const transfer = process.env.TRANSFER === "true";
  const sell = process.env.SELL === "true";
  const buy = process.env.BUY === "true";
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
    useLocalCloudWorker,
    withdraw: withdraw === "true",
    noLog: noLog === "true",
    approveTransfer: approveTransfer === "true",
    shares: shares === "true",
    readOnly: readOnly === "true",
    deploy,
    mint,
    transfer,
    sell,
    buy,
  };
}
