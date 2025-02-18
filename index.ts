import { Cloud, zkCloudWorker, initBlockchain } from "zkcloudworker";
import { initializeBindings } from "o1js";
import { NFTAgent } from "./src/agent.js";

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new NFTAgent(cloud);
}
