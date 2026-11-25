import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDocumentStore } from "./document-store";
import type { Store } from "./store";

export const LOCAL_STATE_PATH = path.join(process.cwd(), ".data", "state.json");

export function createFileStore(filePath = LOCAL_STATE_PATH): Store {
  return createDocumentStore(
    async () => {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async (text) => {
      const directory = path.dirname(filePath);
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `.state-${process.pid}-${Date.now()}.tmp`);
      await writeFile(temporary, text, "utf8");
      await rename(temporary, filePath);
    },
  );
}
