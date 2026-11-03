import type { PigeonLetter } from "./launch.ts";

/** Drop the oldest letters when the inbox reaches its limit. */
export const PIGEON_INBOX_LIMIT = 100;
export interface PigeonStore {
  read(key: string): Promise<PigeonLetter[]>;
  append(key: string, letter: PigeonLetter): Promise<void>;
  done(key: string, id: number): Promise<void>;
  muted(key: string): Promise<boolean>;
  mute(key: string, value: boolean): Promise<void>;
}
export function createMemoryPigeonStore(): PigeonStore {
  let sequence = 0;
  const boxes = new Map<string, PigeonLetter[]>();
  const muted = new Set<string>();
  return {
    read: key => Promise.resolve(structuredClone(boxes.get(key) ?? [])),
    append: (key, letter) => { boxes.set(key, [...(boxes.get(key) ?? []), { ...structuredClone(letter), id: ++sequence }].slice(-PIGEON_INBOX_LIMIT)); return Promise.resolve(); },
    done: (key, id) => { boxes.set(key, (boxes.get(key) ?? []).filter(letter => letter.id !== id)); return Promise.resolve(); },
    muted: key => Promise.resolve(muted.has(key)),
    mute: (key, value) => { if (value) muted.add(key); else muted.delete(key); return Promise.resolve(); },
  };
}
/** Store bodies in IndexedDB and allocate IDs in the same transaction as delivery. */
export function createIndexedDbPigeonStore(name = "binette-apps-pigeon"): PigeonStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => { for (const table of ["inbox", "muted", "sequence"]) if (!request.result.objectStoreNames.contains(table)) request.result.createObjectStore(table); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = undefined; }; resolve(db); };
  });
  async function access<T>(store: string, key: string, update?: (value: T | undefined) => T): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, update ? "readwrite" : "readonly");
      const target = tx.objectStore(store);
      const request = target.get(key);
      let result: T | undefined;
      request.onsuccess = () => { result = request.result as T | undefined; if (update) { result = update(result); target.put(result, key); } };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("受信欄を保存できません。"));
    });
  }
  return {
    read: async key => (await access<PigeonLetter[]>("inbox", key)) ?? [],
    append: async (key, letter) => {
      const copy = structuredClone(letter);
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["inbox", "sequence"], "readwrite");
        const sequence = tx.objectStore("sequence");
        const inbox = tx.objectStore("inbox");
        const number = sequence.get("next");
        number.onsuccess = () => {
          const id = Number(number.result ?? 0) + 1;
          sequence.put(id, "next");
          const request = inbox.get(key);
          request.onsuccess = () => inbox.put([...(request.result ?? []), { ...copy, id }].slice(-PIGEON_INBOX_LIMIT), key);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("受信欄を保存できません。"));
      });
    },
    done: async (key, id) => { await access<PigeonLetter[]>("inbox", key, old => (old ?? []).filter(letter => letter.id !== id)); },
    muted: async key => !!await access<boolean>("muted", key),
    mute: async (key, value) => { await access<boolean>("muted", key, () => value); },
  };
}
