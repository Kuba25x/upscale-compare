import { Capacitor, registerPlugin } from '@capacitor/core';
import { z } from 'zod';
import {
  configSchema,
  metadataSchema,
  imageMetadataSchema,
  type LocalImage,
} from '../../shared/model';

const originalSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
    size: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine((image) => image.width * image.height <= 36_000_000);
const imageSchema = originalSchema.and(
  z.object({ label: z.string().max(120), metadata: imageMetadataSchema }),
);
const sessionSchema = z
  .object({
    images: z.array(imageSchema).max(4),
    metadata: metadataSchema,
    config: configSchema,
  })
  .refine(
    (s) =>
      s.images.length === 0 ||
      (s.images.length >= 2 &&
        s.config.selected.every((i) => i < s.images.length) &&
        s.config.selected[0] !== s.config.selected[1]),
  );
export type AndroidSession = z.infer<typeof sessionSchema>;
type Original = z.infer<typeof originalSchema>;
export type AndroidImage = LocalImage & Original;
const Originals = registerPlugin<{
  pick(options: { limit: number }): Promise<{ images: Original[] }>;
  restore(): Promise<{ session: unknown; paths: Record<string, string> }>;
  paths(options: { ids: string[] }): Promise<{ paths: Record<string, string> }>;
  save(options: { session: AndroidSession }): Promise<{ warning?: string }>;
  discard(options: { ids: string[] }): Promise<void>;
}>('Originals');

function materialize(
  image: z.infer<typeof imageSchema>,
  paths: Record<string, string>,
): AndroidImage {
  if (!paths[image.id])
    throw new Error('A stored original is unavailable. Import the images again.');
  return { ...image, url: Capacitor.convertFileSrc(paths[image.id]) };
}
export async function pickOriginals(limit: number): Promise<AndroidImage[]> {
  const { images } = await Originals.pick({ limit });
  try {
    const checked = images.map((image) => originalSchema.parse(image));
    const { paths } = await Originals.paths({ ids: checked.map((i) => i.id) });
    return checked.map((i) =>
      materialize(
        {
          ...i,
          label: i.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Screenshot',
          metadata: { technology: '', preset: '', renderingResolution: '' },
        },
        paths,
      ),
    );
  } catch (error) {
    await Originals.discard({ ids: images.map((i) => i.id) });
    throw error;
  }
}
let restorePromise: ReturnType<typeof restoreOnce> | undefined;
async function restoreOnce() {
  const { session, paths } = await Originals.restore();
  if (session === null) return null;
  const checked = sessionSchema.parse(session);
  return { ...checked, images: checked.images.map((i) => materialize(i, paths)) };
}
export const restoreAndroidSession = () => (restorePromise ??= restoreOnce());
export async function saveAndroidSession(session: {
  images: LocalImage[];
  config: AndroidSession['config'];
  metadata: AndroidSession['metadata'];
}) {
  return Originals.save({ session: sessionSchema.parse(session) });
}
export async function discardOriginals(images: LocalImage[]) {
  await Originals.discard({ ids: images.map((i) => (i as AndroidImage).id) });
}
