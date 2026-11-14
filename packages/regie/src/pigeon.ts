import type { PigeonLetter, UserLetter } from "./launch.ts";

/** Drop the oldest letters when the inbox reaches its limit. */
export const PIGEON_INBOX_LIMIT = 100;
/** Keep this many letters to the user, newest last. Older ones are dropped even if unopened. */
export const PIGEON_HISTORY_LIMIT = 100;
/** The key of the single history row. */
const HISTORY_KEY = "user";
const trimHistory = (letters: UserLetter[]) => letters.slice(-PIGEON_HISTORY_LIMIT);
export interface PigeonStore {
  /** Letters sent to the user, oldest first. */
  history(): Promise<UserLetter[]>;
  /** Save a letter to the user with its arrival time. The store assigns the ID and returns the saved letter. */
  record(letter: PigeonLetter, time: number): Promise<UserLetter>;
  /** Mark letters to the user as opened. Unknown IDs are ignored. */
  open(ids: number[]): Promise<void>;
  /** Delete letters to the user. Without IDs, delete all of them. */
  forget(ids?: number[]): Promise<void>;
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
  let history: UserLetter[] = [];
  return {
    history: () => Promise.resolve(structuredClone(history)),
    record: (letter, time) => { const saved: UserLetter = { ...structuredClone(letter), id: ++sequence, time, opened: false }; history = trimHistory([...history, saved]); return Promise.resolve(structuredClone(saved)); },
    open: ids => { for (const letter of history) if (ids.includes(letter.id)) letter.opened = true; return Promise.resolve(); },
    forget: ids => { history = ids ? history.filter(letter => !ids.includes(letter.id)) : []; return Promise.resolve(); },
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
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => { for (const table of ["inbox", "muted", "sequence", "history"]) if (!request.result.objectStoreNames.contains(table)) request.result.createObjectStore(table); };
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
  /** Allocate the next ID and add the letter to a row in one transaction, so tabs never reuse an ID. */
  async function deliver<T extends PigeonLetter>(table: "inbox" | "history", key: string, letter: PigeonLetter, add: (old: T[], id: number) => T[]): Promise<void> {
    letter = structuredClone(letter);
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([table, "sequence"], "readwrite");
      const sequence = tx.objectStore("sequence");
      const rows = tx.objectStore(table);
      const number = sequence.get("next");
      number.onsuccess = () => {
        const id = Number(number.result ?? 0) + 1;
        sequence.put(id, "next");
        const request = rows.get(key);
        request.onsuccess = () => rows.put(add(request.result ?? [], id), key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("手紙を保存できません。"));
    });
  }
  return {
    read: async key => (await access<PigeonLetter[]>("inbox", key)) ?? [],
    append: (key, letter) => deliver("inbox", key, letter, (old: PigeonLetter[], id) => [...old, { ...letter, id }].slice(-PIGEON_INBOX_LIMIT)).then(() => {}),
    history: async () => (await access<UserLetter[]>("history", HISTORY_KEY)) ?? [],
    record: async (letter, time) => {
      let saved: UserLetter | undefined;
      await deliver("history", HISTORY_KEY, letter, (old: UserLetter[], id) => trimHistory([...old, saved = { ...letter, id, time, opened: false }]));
      return saved!;
    },
    open: async ids => { await access<UserLetter[]>("history", HISTORY_KEY, old => (old ?? []).map(letter => ids.includes(letter.id) ? { ...letter, opened: true } : letter)); },
    forget: async ids => { await access<UserLetter[]>("history", HISTORY_KEY, old => ids ? (old ?? []).filter(letter => !ids.includes(letter.id)) : []); },
    done: async (key, id) => { await access<PigeonLetter[]>("inbox", key, old => (old ?? []).filter(letter => letter.id !== id)); },
    muted: async key => !!await access<boolean>("muted", key),
    mute: async (key, value) => { await access<boolean>("muted", key, () => value); },
  };
}
