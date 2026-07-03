import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { AppError, ValidationError } from '../lib/errors';
import { generateId } from '../lib/utils';
import { idParamSchema } from '../schemas/common.schema';
import {
  createStorageBatchProjectSchema,
  createStorageProjectSchema,
  projectListFilterSchema,
  supersedeProjectSchema,
} from '../schemas/project.schema';
import { parseStorageUri } from '../lib/storage';
import { projectService, type BatchProjectInput } from '../services/project.service';
import { uploadService } from '../services/upload.service';

const UPLOAD_WINDOW_MS = 60_000;
const uploadAttempts = new Map<string, { count: number; resetAt: number }>();

function enforceUploadRateLimit(request: FastifyRequest): void {
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const current = uploadAttempts.get(ip);

  if (!current || current.resetAt <= now) {
    uploadAttempts.set(ip, { count: 1, resetAt: now + UPLOAD_WINDOW_MS });
    return;
  }

  if (current.count >= config.UPLOAD_RATE_LIMIT_MAX) {
    throw new AppError(429, 'Слишком много загрузок, попробуйте через минуту');
  }

  current.count += 1;
}

export async function projectsRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const filter = projectListFilterSchema.parse(request.query);
    return projectService.listProjects(filter);
  });

  app.post('/', async (request, reply) => {
    enforceUploadRateLimit(request);

    if (request.headers['content-type']?.includes('application/json')) {
      const body = createStorageProjectSchema.parse(request.body ?? {});
      parseStorageUri(body.stepStorageUri);
      if (body.pdfStorageUri) parseStorageUri(body.pdfStorageUri);

      const project = await projectService.createProject(
        { orderNumber: body.orderNumber, quantity: body.quantity, createdBy: body.createdBy },
        { stepStorageUri: body.stepStorageUri, pdfStorageUri: body.pdfStorageUri ?? null }
      );

      return reply.status(201).send({
        data: { id: project.id, orderNumber: body.orderNumber, status: project.status },
      });
    }

    if (config.NODE_ENV === 'production') {
      throw new ValidationError('Production accepts JSON storage references only');
    }
    if (!request.isMultipart()) {
      throw new ValidationError('multipart/form-data обязателен');
    }

    const projectId = generateId();

    try {
      const upload = await uploadService.processUpload(request.parts(), projectId);
      const project = await projectService.createProject(
        {
          id: projectId,
          orderNumber: upload.orderNumber,
          quantity: upload.quantity,
          createdBy: 'local-upload',
        },
        { stepFilePath: upload.stepFilePath, pdfFilePath: upload.pdfFilePath }
      );

      request.log.info({ projectId, orderNumber: upload.orderNumber }, 'Project created and queued for STEP parsing');

      return reply.status(201).send({
        data: {
          id: project.id,
          orderNumber: upload.orderNumber,
          status: project.status,
        },
      });
    } catch (error) {
      await uploadService.cleanupProjectFiles(projectId).catch((cleanupError) => {
        request.log.warn({ cleanupError, projectId }, 'Failed to cleanup project upload files after error');
      });
      throw error;
    }
  });

  app.post('/batch', async (request, reply) => {
    enforceUploadRateLimit(request);

    if (request.headers['content-type']?.includes('application/json')) {
      const body = createStorageBatchProjectSchema.parse(request.body ?? {});
      const inputs: BatchProjectInput[] = body.inputs.map((input) => {
        parseStorageUri(input.stepStorageUri);
        if (input.pdfStorageUri) parseStorageUri(input.pdfStorageUri);
        return {
          ...input,
          pdfStorageUri: input.pdfStorageUri ?? null,
        };
      });
      const project = await projectService.createBatchProject(
        { orderNumber: body.orderNumber, createdBy: body.createdBy },
        inputs
      );
      return reply.status(201).send({
        data: {
          id: project.id,
          orderNumber: body.orderNumber,
          status: project.status,
          inputCount: inputs.length,
        },
      });
    }

    if (config.NODE_ENV === 'production') {
      throw new ValidationError('Production accepts JSON storage references only');
    }
    if (!request.isMultipart()) {
      throw new ValidationError('multipart/form-data Ð¾Ð±ÑÐ·Ð°Ñ‚ÐµÐ»ÐµÐ½');
    }

    const projectId = generateId();

    try {
      const upload = await uploadService.processBatchUpload(request.parts(), projectId);
      const project = await projectService.createBatchProject(
        {
          id: projectId,
          orderNumber: upload.orderNumber,
          createdBy: 'local-upload',
        },
        upload.inputs
      );

      request.log.info(
        { projectId, orderNumber: upload.orderNumber, inputCount: upload.inputs.length },
        'Batch project created and queued for STEP parsing'
      );

      return reply.status(201).send({
        data: {
          id: project.id,
          orderNumber: upload.orderNumber,
          status: project.status,
          inputCount: upload.inputs.length,
        },
      });
    } catch (error) {
      await uploadService.cleanupProjectFiles(projectId).catch((cleanupError) => {
        request.log.warn({ cleanupError, projectId }, 'Failed to cleanup batch project upload files after error');
      });
      throw error;
    }
  });

  app.get('/:id/status', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return projectService.getStatus(id);
  });

  app.get('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return { data: await projectService.getProject(id) };
  });

  app.delete('/:id', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await projectService.deleteProject(id);
    return { success: true };
  });

  app.post('/:id/supersede', async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const body = supersedeProjectSchema.parse(request.body ?? {});
    return { data: await projectService.markSuperseded(id, body.supersededByProjectId) };
  });
}
