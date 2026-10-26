import { z } from 'zod';

export const MAX_IMAGES = 4;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DIMENSION = 16384;
export const MAX_PIXELS = 36_000_000;
export const textField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),
      'Control characters are not allowed.',
    );
export const imageMetadataSchema = z
  .object({
    technology: textField(80).default(''),
    preset: textField(80).default(''),
    renderingResolution: textField(80).default(''),
  })
  .strict();
export const metadataSchema = z
  .object({
    game: textField(120).default(''),
    gpu: textField(160).default(''),
    settings: textField(2000).default(''),
    description: textField(2000).default(''),
  })
  .strict();
export const viewSchema = z
  .object({
    zoom: z.number().min(0.025).max(16).nullable(),
    center: z
      .object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) })
      .strict(),
  })
  .strict();
export const configSchema = z
  .object({
    mode: z.enum(['split', 'side']),
    selected: z.tuple([z.number().int().min(0).max(3), z.number().int().min(0).max(3)]),
    divider: z.number().min(0).max(1),
    view: viewSchema,
  })
  .strict();
export const manifestSchema = z
  .object({
    metadata: metadataSchema,
    config: configSchema,
    images: z
      .array(z.object({ label: textField(120).min(1), metadata: imageMetadataSchema }).strict())
      .min(2)
      .max(MAX_IMAGES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.config.selected.some((index) => index >= value.images.length) ||
      value.config.selected[0] === value.config.selected[1]
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select two different uploaded images.',
        path: ['config', 'selected'],
      });
    }
  });

export type ImageMetadata = z.infer<typeof imageMetadataSchema>;
export type Metadata = z.infer<typeof metadataSchema>;
export type View = z.infer<typeof viewSchema>;
export type Config = z.infer<typeof configSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export interface StoredImage {
  label: string;
  metadata: ImageMetadata;
  width: number;
  height: number;
  size: number;
  type: string;
  name: string;
}
export interface PublicComparison {
  id: string;
  createdAt: string;
  metadata: Metadata;
  config: Config;
  images: StoredImage[];
}
export interface LocalImage extends StoredImage {
  url: string;
  file?: File;
}
export const emptyMetadata = (): Metadata => ({ game: '', gpu: '', settings: '', description: '' });
export const emptyImageMetadata = (): ImageMetadata => ({
  technology: '',
  preset: '',
  renderingResolution: '',
});
