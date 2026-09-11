import { VideoEditProcessor } from '../../queue/processors/video-edit.processor';
import { buildGenericKiePayload, type MediaUploader } from './generic-payload-builder';
import type { InputFieldsSchema } from './input-fields.schema';

// تست پایه‌ای معماری data-driven (طبق پلن، بخش Verification): buildGenericKiePayload باید
// برای هر ۵ خانواده‌ی مدل فعلاً کارکن، دقیقاً همان خروجی ۵ تابع دستی buildXInput
// (video-edit.processor.ts) را تولید کند — پیش‌نیاز فعال‌کردن معماری جدید روی هر مدل واقعی.
// متدهای buildXInput خصوصی‌اند؛ اینجا از (processor as any) برای صدازدن مستقیم آنها در تست
// استفاده می‌شود (فقط برای تست موازی‌سازی، نه یک الگوی معمول در بقیه‌ی کد).

function makeMockUploader(): MediaUploader {
  return {
    uploadOne: async (key: string) => `https://mock/${key}`,
    uploadMany: async (keys: string[]) => keys.map((k) => `https://mock/${k}`),
  };
}

function makeProcessor(): VideoEditProcessor {
  const storage = { downloadImage: jest.fn(async (key: string) => Buffer.from(key)) };
  const kieProvider = {
    uploadFile: jest.fn(async (_buf: Buffer, fileName: string) => ({
      url: `https://mock/${fileName}`,
    })),
  };
  const mediaTranscode = {
    normalizeVideoForProviders: jest.fn(async (buffer: Buffer) => ({
      buffer,
      ext: 'mp4',
    })),
  };
  return new VideoEditProcessor(
    {} as any,
    storage as any,
    {} as any,
    {} as any,
    kieProvider as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    mediaTranscode as any,
  );
}

describe('buildGenericKiePayload — byte-identical parity with legacy buildXInput', () => {
  const uploader = makeMockUploader();
  const processor = makeProcessor();

  it('OMNI: generate branch (no video, with images)', async () => {
    const job = {
      prompt: 'a prompt',
      referenceImageKeys: ['img1.png', 'img2.png'],
      videoKey: null,
      videoWindowStartSec: null,
      videoWindowEndSec: null,
      aspectRatio: '16:9',
      resolution: '720p',
    };
    const legacy = await (processor as any).buildOmniInput(job, 4);

    const schema: InputFieldsSchema = {
      version: 1,
      fields: [
        { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
        {
          key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
          options: [{ value: '720p', label: '720p' }], wireValueType: 'string', semantic: 'resolution', required: true, order: 1,
        },
        {
          key: 'video', kieField: 'video_list', label: 'ویدیو', type: 'video', accept: ['video/mp4'],
          wireShape: 'objectWithWindow', objectWindowKeys: { url: 'url', start: 'start', end: 'ends' },
          trim: { enabled: true, maxWindowSec: 8 }, required: false, order: 2,
        },
        {
          key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'freeRange',
          range: { min: 1, max: 30 }, wireValueType: 'string', default: 4,
          omitWhen: { kind: 'fieldPresent', fieldKey: 'video' }, required: false, order: 3,
        },
        {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '16:9', label: '16:9' }], wireValueType: 'string', semantic: 'aspectRatio',
          required: false, order: 4,
        },
        {
          key: 'images', kieField: 'image_urls', label: 'تصاویر مرجع', type: 'imageArray',
          accept: ['image/png'], required: false, order: 5,
        },
      ],
    };
    const values = { prompt: 'a prompt', resolution: '720p', duration: 4, aspectRatio: '16:9', images: ['img1.png', 'img2.png'] };
    const generic = await buildGenericKiePayload(schema, values, uploader);

    expect(generic).toEqual(legacy);
  });

  it('OMNI: edit branch (video with window, no images)', async () => {
    const job = {
      prompt: 'edit prompt',
      referenceImageKeys: [],
      videoKey: 'vid.mp4',
      videoWindowStartSec: 2,
      videoWindowEndSec: 6,
      aspectRatio: '16:9',
      resolution: '720p',
    };
    const legacy = await (processor as any).buildOmniInput(job, 4);

    const schema: InputFieldsSchema = {
      version: 1,
      fields: [
        { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
        {
          key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
          options: [{ value: '720p', label: '720p' }], wireValueType: 'string', semantic: 'resolution', required: true, order: 1,
        },
        {
          key: 'video', kieField: 'video_list', label: 'ویدیو', type: 'video', accept: ['video/mp4'],
          wireShape: 'objectWithWindow', objectWindowKeys: { url: 'url', start: 'start', end: 'ends' },
          trim: { enabled: true, maxWindowSec: 8 }, required: false, order: 2,
        },
        {
          key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'freeRange',
          range: { min: 1, max: 30 }, wireValueType: 'string', default: 4,
          omitWhen: { kind: 'fieldPresent', fieldKey: 'video' }, required: false, order: 3,
        },
        {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '16:9', label: '16:9' }], wireValueType: 'string', semantic: 'aspectRatio',
          required: false, order: 4,
        },
        {
          key: 'images', kieField: 'image_urls', label: 'تصاویر مرجع', type: 'imageArray',
          accept: ['image/png'], required: false, order: 5,
        },
      ],
    };
    const values = { prompt: 'edit prompt', resolution: '720p', aspectRatio: '16:9', video: { key: 'vid.mp4', windowStartSec: 2, windowEndSec: 6 } };
    const generic = await buildGenericKiePayload(schema, values, uploader);

    expect(legacy.aspect_ratio).toBe('16:9');
    expect(generic).toEqual(legacy);
  });

  const seedanceSchema: InputFieldsSchema = {
    version: 1,
    fields: [
      { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
      {
        key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
        options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }], wireValueType: 'string',
        semantic: 'resolution', required: true, order: 1,
      },
      {
        key: 'video', kieField: 'reference_video_urls', label: 'ویدیوی مرجع', type: 'video',
        accept: ['video/mp4'], wireShape: 'arrayOfUrl', required: false, order: 2,
      },
      {
        key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'freeRange',
        range: { min: 1, max: 30 }, wireValueType: 'number', default: 4,
        autoSentinel: { value: -1, triggerWhen: { kind: 'fieldPresent', fieldKey: 'video' } },
        required: false, order: 3,
      },
      {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '9:16', label: '9:16' }], wireValueType: 'string', semantic: 'aspectRatio',
          required: false, order: 4,
      },
      {
        key: 'images', kieField: 'reference_image_urls', label: 'تصاویر مرجع', type: 'imageArray',
        accept: ['image/png'], required: false, order: 5,
      },
    ],
  };

  it('SEEDANCE: generate branch (images, no video)', async () => {
    const job = {
      prompt: 'p', referenceImageKeys: ['a.png'], videoKey: null,
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '9:16', resolution: '480p',
    };
    const legacy = await (processor as any).buildSeedanceInput(job, 6);
    const values = { prompt: 'p', resolution: '480p', duration: 6, aspectRatio: '9:16', images: ['a.png'] };
    const generic = await buildGenericKiePayload(seedanceSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });

  it('SEEDANCE: video-ref branch (sentinel -1)', async () => {
    const job = {
      prompt: 'p2', referenceImageKeys: [], videoKey: 'ref.mp4',
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '9:16', resolution: '720p',
    };
    const legacy = await (processor as any).buildSeedanceInput(job, 6);
    const values = { prompt: 'p2', resolution: '720p', aspectRatio: '9:16', video: { key: 'ref.mp4' } };
    const generic = await buildGenericKiePayload(seedanceSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });

  function wanV2VSchema(): InputFieldsSchema {
    return {
      version: 1,
      fields: [
        { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
        {
          key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
          options: [{ value: '720p', label: '720p' }], wireValueType: 'string', semantic: 'resolution', required: true, order: 1,
        },
        {
          key: 'video', kieField: 'video_urls', label: 'ویدیو', type: 'video', accept: ['video/mp4'],
          wireShape: 'arrayOfUrl', required: false, order: 2,
        },
        {
          key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'fixedList',
          fixedOptions: [5, 10], snapToNearestAllowed: true, wireValueType: 'string', default: 5, required: true, order: 3,
        },
        {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '16:9', label: '16:9' }], wireValueType: 'string', semantic: 'aspectRatio',
          required: false, order: 4,
        },
      ],
    };
  }

  it('WAN_V2V: no-video branch (snap to nearest fixed duration)', async () => {
    const job = {
      prompt: 'p3', referenceImageKeys: [], videoKey: null,
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '16:9', resolution: '720p',
    };
    const model = { fixedDurations: [5, 10] } as any;
    const legacy = await (processor as any).buildWanV2VInput(job, model, 7);
    const values = { prompt: 'p3', resolution: '720p', duration: 7, aspectRatio: '16:9' };
    const generic = await buildGenericKiePayload(wanV2VSchema(), values, uploader);
    expect(generic).toEqual(legacy);
  });

  it('WAN_V2V: video branch', async () => {
    const job = {
      prompt: 'p4', referenceImageKeys: [], videoKey: 'v2.mp4',
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '16:9', resolution: '720p',
    };
    const model = { fixedDurations: [5, 10] } as any;
    const legacy = await (processor as any).buildWanV2VInput(job, model, 7);
    const values = { prompt: 'p4', resolution: '720p', duration: 7, aspectRatio: '16:9', video: { key: 'v2.mp4' } };
    const generic = await buildGenericKiePayload(wanV2VSchema(), values, uploader);
    expect(generic).toEqual(legacy);
  });

  const wanR2VSchema: InputFieldsSchema = {
    version: 1,
    fields: [
      { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
      {
        key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
        options: [{ value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }], wireValueType: 'string',
        semantic: 'resolution', required: true, order: 1,
      },
      {
        key: 'video', kieField: 'reference_video', label: 'ویدیوی مرجع', type: 'video',
        accept: ['video/mp4'], wireShape: 'arrayOfUrl', required: false, order: 2,
      },
      {
        key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'freeRange',
        range: { min: 2, max: 10 }, wireValueType: 'number', default: 4, required: true, order: 3,
      },
      {
        key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
        options: [{ value: '16:9', label: '16:9' }], wireValueType: 'string', semantic: 'aspectRatio',
        required: false, order: 4,
      },
      {
        key: 'images', kieField: 'reference_image', label: 'تصاویر مرجع', type: 'imageArray',
        accept: ['image/png'], required: false, order: 5,
      },
    ],
  };

  it('WAN_R2V: images branch (duration clamped to max)', async () => {
    const job = {
      prompt: 'p5', referenceImageKeys: ['b.png', 'c.png'], videoKey: null,
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '16:9', resolution: '1080p',
    };
    const legacy = await (processor as any).buildWanR2VInput(job, 15);
    const values = { prompt: 'p5', resolution: '1080p', duration: 15, aspectRatio: '16:9', images: ['b.png', 'c.png'] };
    const generic = await buildGenericKiePayload(wanR2VSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });

  it('WAN_R2V: video branch (duration clamped to min)', async () => {
    const job = {
      prompt: 'p6', referenceImageKeys: [], videoKey: 'v3.mp4',
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '16:9', resolution: '720p',
    };
    const legacy = await (processor as any).buildWanR2VInput(job, 1);
    const values = { prompt: 'p6', resolution: '720p', duration: 1, aspectRatio: '16:9', video: { key: 'v3.mp4' } };
    const generic = await buildGenericKiePayload(wanR2VSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });

  const wanVideoEditSchema: InputFieldsSchema = {
    version: 1,
    fields: [
      { key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text', multiline: true, required: true, order: 0 },
      {
        key: 'resolution', kieField: 'resolution', label: 'رزولوشن', type: 'enum',
        options: [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }], wireValueType: 'string',
        semantic: 'resolution', required: true, order: 1,
      },
      {
        key: 'video', kieField: 'video_url', label: 'ویدیو', type: 'video', accept: ['video/mp4'],
        wireShape: 'scalarUrl', required: false, order: 2,
      },
      {
        key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration', mode: 'freeRange',
        range: { min: 1, max: 30 }, wireValueType: 'number', default: 4,
        autoSentinel: { value: 0, triggerWhen: { kind: 'fieldPresent', fieldKey: 'video' } },
        required: false, order: 3,
      },
      {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '9:16', label: '9:16' }], wireValueType: 'string', semantic: 'aspectRatio',
          required: false, order: 4,
      },
      {
        key: 'images', kieField: 'reference_image', label: 'تصاویر مرجع', type: 'imageArray',
        accept: ['image/png'], required: false, order: 5,
      },
    ],
  };

  it('WAN_VIDEO_EDIT: images branch (no video)', async () => {
    const job = {
      prompt: 'p7', referenceImageKeys: ['d.png'], videoKey: null,
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '9:16', resolution: '480p',
    };
    const legacy = await (processor as any).buildWanVideoEditInput(job, 8);
    const values = { prompt: 'p7', resolution: '480p', duration: 8, aspectRatio: '9:16', images: ['d.png'] };
    const generic = await buildGenericKiePayload(wanVideoEditSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });

  it('WAN_VIDEO_EDIT: video branch (sentinel 0, scalar video_url)', async () => {
    const job = {
      prompt: 'p8', referenceImageKeys: [], videoKey: 'v4.mp4',
      videoWindowStartSec: null, videoWindowEndSec: null, aspectRatio: '9:16', resolution: '720p',
    };
    const legacy = await (processor as any).buildWanVideoEditInput(job, 8);
    const values = { prompt: 'p8', resolution: '720p', aspectRatio: '9:16', video: { key: 'v4.mp4' } };
    const generic = await buildGenericKiePayload(wanVideoEditSchema, values, uploader);
    expect(generic).toEqual(legacy);
  });
});
