import { getStore as getNetlifyBlobStore } from "@netlify/blobs";
import { createDocumentStore } from "./document-store";
import type { Store } from "./store";

const BLOB_STORE_NAME = "newsletter-cleanup";
const STATE_KEY = "state";

export type BlobTextClient = {
  get(key: string, options: { type: "text" }): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
};

export function createBlobDocumentStore(blobs: BlobTextClient): Store {
  return createDocumentStore(
    async () => {
      const value = await blobs.get(STATE_KEY, { type: "text" });
      return value?.trim() ? value : null;
    },
    async (text) => {
      await blobs.set(STATE_KEY, text);
    },
    "Stored state is not valid JSON.",
  );
}

/** Netlify injects the Blobs context in its functions runtime. No token is read from the project env. */
export function createNetlifyBlobStore(): Store {
  const blobs = getNetlifyBlobStore({ name: BLOB_STORE_NAME, consistency: "strong" });
  return createBlobDocumentStore({
    async get(key, options) {
      const value = await blobs.get(key, options);
      return value ?? null;
    },
    set(key, value) {
      return blobs.set(key, value);
    },
  });
}
