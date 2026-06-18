import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSignedUpload, parseStorageUri, removeOwnedStorageUris } from '../lib/storage';

const signedUploadSchema = z.object({
  kind: z.enum(['step', 'pdf']),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().max(200).optional(),
  size: z.coerce.number().int().positive(),
}).superRefine((value, context) => {
  const lowerName = value.fileName.toLowerCase();
  const validExtension = value.kind === 'step'
    ? lowerName.endsWith('.step') || lowerName.endsWith('.stp')
    : lowerName.endsWith('.pdf');
  const maxBytes = value.kind === 'step' ? 500 * 1024 * 1024 : 50 * 1024 * 1024;

  if (!validExtension) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unsupported file extension', path: ['fileName'] });
  }
  if (value.size > maxBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'File is too large', path: ['size'] });
  }
});

export async function uploadsRoutes(app: FastifyInstance) {
  app.post('/signed-url', async (request, reply) => {
    const body = signedUploadSchema.parse(request.body ?? {});
    const signedUpload = await createSignedUpload(body.kind, body.fileName);
    return reply.status(201).send({ data: signedUpload });
  });

  app.delete('/', async (request) => {
    const body = z.object({
      storageUris: z.array(z.string().startsWith('supabase://')).min(1).max(10),
    }).parse(request.body ?? {});

    for (const uri of body.storageUris) {
      const { bucket, objectPath } = parseStorageUri(uri);
      if (bucket !== 'nesting-files' || !objectPath.startsWith('uploads/')) {
        throw new Error('Only unclaimed upload objects can be removed here');
      }
    }
    await removeOwnedStorageUris(body.storageUris);
    return { success: true };
  });
}
