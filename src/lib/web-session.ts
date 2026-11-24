import { z } from 'zod';
import {
  MAX_IMAGES,
  alignmentChoicesSchema,
  imageMetadataSchema,
  localConfigSchema,
  metadataSchema,
  type AlignmentChoices,
  type Config,
  type LocalImage,
  type Metadata,
} from '../../shared/model';

const sessionSchema = z
  .object({
    images: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          size: z.number().int().positive(),
          width: z.number().int().positive(),
          height: z.number().int().positive(),
          label: z.string(),
          metadata: imageMetadataSchema,
        }),
      )
      .min(2)
      .max(MAX_IMAGES),
    config: localConfigSchema,
    metadata: metadataSchema,
    alignmentChoices: alignmentChoicesSchema.optional(),
  })
  .refine(
    ({ config, images }) =>
      config.selected[0] !== config.selected[1] &&
      config.selected.every((index) => index < images.length) &&
      new Set(images.map(({ id }) => id)).size === images.length,
  );
type StoredSession = z.infer<typeof sessionSchema>;
type Record = { revision: number; session?: StoredSession };
type StoredOriginal = { bytes: ArrayBuffer; lastModified: number };
export type LocalSession = {
  images: LocalImage[];
  config: Config;
  metadata: Metadata;
  alignmentChoices?: AlignmentChoices;
};

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function webSessionError(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Browser storage is full. This comparison is open, but the latest changes could not be saved.';
  return `Could not save the local session: ${error instanceof Error ? error.message : String(error)}`;
}

export async function requestPersistentStorage() {
  try {
    const storage = navigator.storage;
    if (storage?.persist && !(await storage.persisted?.())) await storage.persist();
  } catch {
    // Browser policy and storage permissions do not determine whether IndexedDB can save.
  }
}

export function createWebSessionStore() {
  const name = `upscale-compare:session:${new URL(import.meta.env.BASE_URL, location.href).pathname}`;
  let connection: Promise<IDBDatabase> | undefined;
  let revision = 0;
  let storedIds = new Set<IDBValidKey>();
  let writes = Promise.resolve();

  function open() {
    return (connection ??= Promise.resolve()
      .then(async () => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('state');
          request.result.createObjectStore('originals');
        };
        const database = await read(request);
        database.onversionchange = () => {
          database.close();
          connection = undefined;
        };
        return database;
      })
      .catch((error) => {
        connection = undefined;
        throw error;
      }));
  }

  async function restore(): Promise<LocalSession | null> {
    const database = await open();
    const transaction = database.transaction(['state', 'originals']);
    const originals = transaction.objectStore('originals');
    const [record, keys, files] = await Promise.all([
      read<Record | undefined>(transaction.objectStore('state').get('current')),
      read(originals.getAllKeys()),
      read<(StoredOriginal | File)[]>(originals.getAll()),
    ]);
    revision = record?.revision ?? 0;
    storedIds = new Set(keys);
    if (!record?.session) return null;
    const session = sessionSchema.parse(record.session);
    const byId = new Map(keys.map((id, index) => [id, files[index]]));
    const selectedFiles = session.images.map(({ id, size, name, type }) => {
      const original = byId.get(id);
      const file =
        original instanceof File
          ? original
          : original?.bytes instanceof ArrayBuffer
            ? new File([original.bytes], name, { type, lastModified: original.lastModified })
            : undefined;
      if (!file || file.size !== size || file.name !== name || file.type !== type)
        throw new Error('A saved original is unavailable. Import the images again.');
      return file;
    });
    return {
      ...session,
      images: session.images.map((image, index) => {
        const file = selectedFiles[index];
        return { ...image, file, url: URL.createObjectURL(file) };
      }),
    };
  }

  function save(snapshot: LocalSession, clear = false): Promise<void> {
    const committed = writes.then(async () => {
      const database = await open();
      const { images, ...config } = snapshot;
      const files =
        images.length < 2
          ? []
          : images.map(({ id, file }) => {
              if (!id || !file) throw new Error('A local original is unavailable.');
              return { id, file };
            });
      const session =
        files.length === 0
          ? undefined
          : sessionSchema.parse({
              ...config,
              images: images.map(({ url: _url, file: _file, ...image }) => image),
            });
      const currentIds = new Set<IDBValidKey>(files.map(({ id }) => id));
      // Store encoded bytes directly. Some WebKit environments cannot persist File objects.
      const addedFiles = await Promise.all(
        files
          .filter(({ id }) => !storedIds.has(id))
          .map(async ({ id, file }) => ({
            id,
            bytes: await file.arrayBuffer(),
            lastModified: file.lastModified,
          })),
      );

      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['state', 'originals'], 'readwrite');
        const state = transaction.objectStore('state');
        const originals = transaction.objectStore('originals');
        const current = state.get('current');
        let failure: unknown;
        let nextRevision: number;
        transaction.onerror = (event) => {
          failure ??= (event.target as IDBRequest).error;
        };
        transaction.onabort = () => reject(failure ?? transaction.error);
        transaction.oncomplete = () => {
          revision = nextRevision;
          storedIds = currentIds;
          resolve();
        };
        current.onsuccess = () => {
          try {
            const record: Record | undefined = current.result;
            const currentRevision = record?.revision ?? 0;
            if (!clear && revision !== currentRevision)
              throw new Error(
                'This comparison changed in another tab. Reload to edit the saved session.',
              );
            nextRevision = currentRevision + 1;
            if (!session) originals.clear();
            else {
              for (const id of storedIds) if (!currentIds.has(id)) originals.delete(id);
              for (const { id, ...original } of addedFiles) originals.put(original, id);
            }
            state.put(
              session ? { revision: nextRevision, session } : { revision: nextRevision },
              'current',
            );
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
      });
    });
    writes = committed.catch(() => {});
    return committed;
  }

  return { restore, save };
}
