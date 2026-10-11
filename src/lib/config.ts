import { studionet } from "genlayer-js/chains";

import deployment from "../../deployments/studionet.json";

/**
 * The sole place network and contract address are resolved. The SDK's StudioNet
 * chain object is the network authority: the app never defines a simulator
 * chain and never falls back to one. The committed manifest is the address of
 * record; NEXT_PUBLIC_CONTRACT_ADDRESS may point a preview at another deploy.
 */
export const CHAIN = studionet;
export const CHAIN_ID = deployment.chainId;
export const CHAIN_HEX = deployment.chainIdHex as `0x${string}`;
export const CHAIN_NAME = deployment.chainName;
export const CHAIN_RPC = process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || deployment.rpcUrl;
export const EXPLORER = (process.env.NEXT_PUBLIC_EXPLORER_URL || deployment.explorerUrl).replace(/\/+$/, "");

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  deployment.contract.address) as `0x${string}`;
export const EXPECTED_REVISION = deployment.contract.version;
export const SOURCE_SHA256 = deployment.contract.sourceSha256;
export const IS_ADDRESS_OF_RECORD =
  CONTRACT_ADDRESS.toLowerCase() === deployment.contract.address.toLowerCase();

if (CHAIN.id !== CHAIN_ID) {
  throw new Error("The GenLayer SDK StudioNet chain does not match the manifest's chain id.");
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${EXPLORER}/address/${address}`;
export const CONTRACT_EXPLORER_URL = addressUrl(CONTRACT_ADDRESS);

export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: CHAIN_NAME,
  rpcUrls: [CHAIN_RPC],
  nativeCurrency: deployment.nativeCurrency,
  blockExplorerUrls: [EXPLORER],
};
