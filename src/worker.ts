import {
  zkCloudWorker,
  Cloud,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
  transactionParams,
  parseTransactionPayloads,
  TinyContract,
  TransactionMetadata,
} from "zkcloudworker";
import {
  TokenTransaction,
  TransactionParams,
  LaunchTokenStandardAdminParams,
  LaunchTokenAdvancedAdminParams,
  FungibleTokenTransactionType,
  JobResult,
} from "@minatokens/api";
import {
  FungibleToken,
  AdvancedFungibleToken,
  tokenContracts,
  tokenVerificationKeys,
  buildTokenLaunchTransaction,
  buildTokenTransaction,
  LAUNCH_FEE,
  TRANSACTION_FEE,
} from "@minatokens/token";
import {
  VerificationKey,
  PublicKey,
  Mina,
  Cache,
  UInt64,
  UInt8,
  Field,
  Transaction,
} from "o1js";
const WALLET = process.env.WALLET;

interface TinyTransactionParams {
  chain: string;
  contractAddress: string;
  serializedTransaction: string;
  sender: string;
  value: number;
  sendTransaction: boolean;
}
export class TokenLauncherWorker extends zkCloudWorker {
  static verificationKeys: {
    [key: string]: VerificationKey;
  } = {};

  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
  }

  private async compile(params: {
    compileAdmin?: boolean;
    isAdvanced?: boolean;
    verificationKeyHashes: string[];
  }): Promise<void> {
    console.log("Compile", params);
    const {
      compileAdmin = false,
      isAdvanced = false,
      verificationKeyHashes,
    } = params;
    try {
      console.time("compiled");
      const vk =
        tokenVerificationKeys[
          this.cloud.chain === "mainnet" ? "mainnet" : "testnet"
        ].vk;
      for (const hash of verificationKeyHashes) {
        const [key, item] =
          Object.entries(vk).find(([_, item]) => item.hash === hash) || [];
        if (!key) throw new Error(`Key not found for hash ${hash}`);
        if (!item) throw new Error(`Verification key for ${hash} not found`);
        console.log("Compiling", item.type, key);
        switch (item.type) {
          case "token":
            if (isAdvanced) {
              if (!TokenLauncherWorker.verificationKeys.AdvancedFungibleToken) {
                console.time("compiled advanced fungible token");
                TokenLauncherWorker.verificationKeys.AdvancedFungibleToken = (
                  await AdvancedFungibleToken.compile({
                    cache: this.cache,
                  })
                ).verificationKey;
                console.timeEnd("compiled advanced fungible token");
              }
              if (
                TokenLauncherWorker.verificationKeys.AdvancedFungibleToken.hash.toJSON() !==
                hash
              )
                throw new Error(
                  `Verification key for ${key} (${hash}) does not match`
                );
            } else {
              if (!TokenLauncherWorker.verificationKeys.FungibleToken) {
                console.time("compiled fungible token");
                TokenLauncherWorker.verificationKeys.FungibleToken = (
                  await FungibleToken.compile({
                    cache: this.cache,
                  })
                ).verificationKey;
                console.timeEnd("compiled fungible token");
              }
              if (
                TokenLauncherWorker.verificationKeys.FungibleToken.hash.toJSON() !==
                hash
              )
                throw new Error(
                  `Verification key for ${key} (${hash}) does not match`
                );
            }
            break;

          case "admin":
          case "user":
            const contract = tokenContracts[key];
            if (!contract) throw new Error(`Contract ${key} not found`);
            if (!TokenLauncherWorker.verificationKeys[key]) {
              console.time(`compiled ${key}`);
              TokenLauncherWorker.verificationKeys[key] = (
                await contract.compile({
                  cache: this.cache,
                })
              ).verificationKey;
              console.timeEnd(`compiled ${key}`);
            }
            if (
              TokenLauncherWorker.verificationKeys[key].hash.toJSON() !== hash
            )
              throw new Error(
                `Verification key for ${key} (${hash}) does not match`
              );
            break;

          case "upgrade":
            throw new Error(`Upgrade key ${key} (${hash}) not supported`);
        }
      }

      console.timeEnd("compiled");
    } catch (error) {
      console.error("Error in compile, restarting container", error);
      // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
      await this.cloud.forceWorkerRestart();
      throw error;
    }
  }

  public async create(transaction: string): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    if (transactions.length === 0) throw new Error("transactions is empty");
    if (this.cloud.task !== "prove") throw new Error("Invalid task");
    const proofs: string[] = [];
    for (const transaction of transactions) {
      const tx = JSON.parse(transaction) as TokenTransaction;
      switch (tx.txType) {
        case "launch":
          proofs.push(await this.launch(tx));
          break;

        case "transfer":
        case "mint":
        case "offer":
        case "bid":
        case "sell":
        case "buy":
        case "withdrawOffer":
        case "withdrawBid":
        case "updateBidWhitelist":
        case "updateOfferWhitelist":
        case "updateAdminWhitelist":
          proofs.push(await this.transaction(tx));
          break;

        default:
          throw new Error(`Unknown txType: ${tx.txType}`);
      }
    }
    const result = JSON.stringify({ proofs }, null, 2);
    console.log("Proofs size", result.length);
    if (result.length > 350_000)
      console.error("Proofs size is too large:", result.length);
    return result;
  }

  private stringifyJobResult(result: JobResult): string {
    /*
        export interface JobResult {
          success: boolean;
          error?: string;
          tx?: string;
          hash?: string;
          jobStatus?: string;
        }
    */
    const strippedResult = {
      ...result,
      tx: result.hash ? undefined : result.tx,
    };
    return JSON.stringify(strippedResult, null, 2);
  }

  private async launch(args: TokenTransaction): Promise<string> {
    if (
      !("adminContractAddress" in args.request) ||
      args.request.adminContractAddress === undefined ||
      args.sender === undefined ||
      args.transaction === undefined ||
      args.signedData === undefined ||
      args.request.tokenAddress === undefined ||
      args.request.uri === undefined ||
      args.symbol === undefined
    ) {
      throw new Error("One or more required args are undefined");
    }
    const sendTransaction = args.sendTransaction ?? true;
    if (WALLET === undefined) throw new Error("WALLET is undefined");

    // const contractAddress = PublicKey.fromBase58(args.tokenAddress);
    // console.log("Contract", contractAddress.toBase58());
    // const adminContractAddress = PublicKey.fromBase58(
    //   args.adminContractAddress
    // );
    // console.log("Admin Contract", adminContractAddress.toBase58());
    // const developerAddress = args.developerAddress
    //   ? PublicKey.fromBase58(args.developerAddress)
    //   : undefined;
    // const developerFee = args.developerFee
    //   ? UInt64.from(args.developerFee)
    //   : undefined;

    console.time("prepared tx");
    // const signedJson = JSON.parse(args.signedData);

    const { fee, sender, nonce, memo } = transactionParams(args);
    console.log("Admin (sender)", sender.toBase58());
    if (sender.toBase58() != args.sender) throw new Error("Invalid sender");

    // const {
    //   tx: txNew,
    //   isAdvanced,
    //   verificationKeyHashes,
    // } = await buildTokenDeployTransaction({
    //   adminType: args.adminType,
    //   chain: this.cloud.chain,
    //   fee,
    //   sender,
    //   nonce,
    //   memo,
    //   tokenAddress: contractAddress,
    //   adminContractAddress,
    //   adminAddress: sender,
    //   uri: args.uri,
    //   symbol: args.symbol,
    //   whitelist: args.whitelist,
    //   decimals: UInt8.from(9),
    //   provingKey: PublicKey.fromBase58(WALLET),
    //   provingFee: UInt64.from(LAUNCH_FEE),
    //   developerAddress,
    //   developerFee,
    // });
    const {
      tx: txNew,
      isAdvanced,
      verificationKeyHashes,
    } = await buildTokenLaunchTransaction({
      chain: this.cloud.chain,
      args: args.request,
      provingKey: WALLET,
      provingFee: LAUNCH_FEE,
    });
    const tx = parseTransactionPayloads({ payloads: args, txNew });

    if (tx === undefined) throw new Error("tx is undefined");
    await this.compile({
      compileAdmin: true,
      isAdvanced,
      verificationKeyHashes,
    });

    console.time("proved tx");
    const txProved = await tx.prove();
    const txJSON = txProved.toJSON();
    console.timeEnd("proved tx");
    console.timeEnd("prepared tx");

    try {
      if (!sendTransaction) {
        return this.stringifyJobResult({
          success: true,
          tx: txJSON,
        });
      }
      return await this.sendTokenTransaction({
        tx: txProved,
        txJSON,
        memo,
        metadata: {
          admin: sender.toBase58(),
          tokenAddress: args.request.tokenAddress,
          adminContractAddress: args.request.adminContractAddress,
          symbol: args.symbol,
          uri: args.request.uri,
          txType: "launch",
        } as any,
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }

  private async transaction(args: TokenTransaction): Promise<string> {
    const { txType } = args;
    console.log("transaction:", {
      ...args,
      minaSignerPayload: undefined,
      walletPayload: undefined,
      proverPayload: undefined,
      signedData: undefined,
      transaction: undefined,
    });

    if (txType === undefined || args.request.tokenAddress === undefined) {
      throw new Error("One or more required args are undefined");
    }
    const sendTransaction = args.sendTransaction ?? true;
    if (WALLET === undefined) throw new Error("WALLET is undefined");
    // if (txType === "offer" || txType === "bid") {
    //   if (args.price === undefined) throw new Error("Price is required");
    // }
    // if (
    //   txType === "sell" ||
    //   txType === "buy" ||
    //   txType === "offer" ||
    //   txType === "bid"
    // ) {
    //   if (args.amount === undefined) throw new Error("Amount is required");
    // }

    // const tokenAddress = PublicKey.fromBase58(args.tokenAddress);
    // console.log(txType, "tx for", tokenAddress.toBase58());
    // const from = PublicKey.fromBase58(args.from);
    // const to = PublicKey.fromBase58(args.to);
    // const amount = args.amount ? UInt64.from(args.amount) : undefined;
    // const developerAddress = args.developerAddress
    //   ? PublicKey.fromBase58(args.developerAddress)
    //   : undefined;
    // const developerFee = args.developerFee
    //   ? UInt64.from(args.developerFee)
    //   : undefined;
    // const price = args.price ? UInt64.from(args.price) : undefined;

    console.time("prepared tx");

    const { fee, sender, nonce, memo } = transactionParams(args);

    // const {
    //   tx: txNew,
    //   isAdvanced,
    //   verificationKeyHashes,
    //   symbol,
    // } = await buildTokenTransaction({
    //   txType,
    //   sender,
    //   chain: this.cloud.chain,
    //   fee,
    //   nonce,
    //   memo,
    //   tokenAddress,
    //   whitelist,
    //   provingKey: PublicKey.fromBase58(WALLET),
    //   provingFee: UInt64.from(TRANSACTION_FEE),
    //   from,
    //   to,
    //   amount,
    //   price,
    //   developerAddress,
    //   developerFee,
    // });
    if (txType === "launch") {
      throw new Error("Launch transaction is not supported");
    }
    const {
      tx: txNew,
      isAdvanced,
      verificationKeyHashes,
      symbol,
    } = await buildTokenTransaction({
      chain: this.cloud.chain,
      args: args.request as Exclude<
        TransactionParams,
        LaunchTokenStandardAdminParams | LaunchTokenAdvancedAdminParams
      >,
      provingKey: WALLET,
      provingFee: TRANSACTION_FEE,
    });

    const tx = parseTransactionPayloads({ payloads: args, txNew });
    if (tx === undefined) throw new Error("tx is undefined");

    // const compileOffer = (
    //   [
    //     "offer",
    //     "buy",
    //     "withdrawOffer",
    //     "updateOfferWhitelist",
    //   ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    // ).includes(txType);
    // const compileBid = (
    //   [
    //     "bid",
    //     "sell",
    //     "withdrawBid",
    //     "updateBidWhitelist",
    //   ] satisfies FungibleTokenTransactionType[] as FungibleTokenTransactionType[]
    // ).includes(txType);
    const compileAdmin = txType === "mint" || txType === "updateAdminWhitelist";
    await this.compile({
      compileAdmin,
      isAdvanced: isAdvanced && compileAdmin,
      verificationKeyHashes,
    });

    console.time("proved tx");
    console.log(`Proving ${txType} transaction...`);
    const txProved = await tx.prove();
    console.timeEnd("proved tx");
    const txJSON = txProved.toJSON();
    console.timeEnd("prepared tx");

    try {
      if (!sendTransaction) {
        return this.stringifyJobResult({
          success: true,
          tx: txJSON,
        });
      }
      return await this.sendTokenTransaction({
        tx: txProved,
        txJSON,
        memo,
        metadata: {
          type: txType,
          sender: sender.toBase58(),
          tokenAddress: args.request.tokenAddress,
          symbol,
        } as any,
      });
    } catch (error) {
      console.error("Error sending transaction", error);
      return this.stringifyJobResult({
        success: false,
        tx: txJSON,
        error: String(error),
      });
    }
  }

  private async sendTokenTransaction(params: {
    tx: Transaction<true, true>;
    txJSON: string;
    memo: string;
    metadata: TransactionMetadata;
  }): Promise<string> {
    const { tx, txJSON, memo, metadata } = params;
    let txSent;
    let sent = false;
    const start = Date.now();
    const timeout = 60 * 1000;
    while (!sent) {
      txSent = await tx.safeSend();
      if (txSent.status == "pending") {
        sent = true;
        console.log(
          `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
        );
      } else if (this.cloud.chain === "zeko" && Date.now() - start < timeout) {
        console.log("Retrying Zeko tx", txSent.status, txSent.errors);
        await sleep(10000);
      } else {
        console.log(
          `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`,
          txSent.errors
        );
        // TODO: handle right API handling on tx-result
        this.cloud.publishTransactionMetadata({
          txId: txSent?.hash,
          metadata: {
            ...metadata,
            txStatus: txSent?.status,
            txErrors: txSent?.errors,
          } as any,
        });
        return this.stringifyJobResult({
          success: false,
          tx: txJSON,
          hash: txSent.hash,
          status: txSent.status,
          error: String(txSent.errors),
        });
      }
    }
    if (this.cloud.isLocalCloud && txSent?.status === "pending") {
      const txIncluded = await txSent.safeWait();
      console.log(
        `${memo} tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
      );
      return this.stringifyJobResult({
        success: true,
        tx: txJSON,
        hash: txIncluded.hash,
      });
    }
    if (txSent?.hash)
      this.cloud.publishTransactionMetadata({
        txId: txSent?.hash,
        metadata: {
          ...metadata,
          txStatus: txSent?.status,
          txErrors: txSent?.errors,
        } as any,
      });
    return this.stringifyJobResult({
      success:
        txSent?.hash !== undefined && txSent?.status == "pending"
          ? true
          : false,
      tx: txJSON,
      hash: txSent?.hash,
      status: txSent?.status,
      error: String(txSent?.errors ?? ""),
    });
  }
}
