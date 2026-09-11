import { keepAspectRatioVisibleWithVideo, parseInputFields } from './input-fields.schema';

describe('keepAspectRatioVisibleWithVideo', () => {
  it('strips visibleWhen fieldAbsent(video) from aspectRatio but keeps duration omitWhen', () => {
    const schema = parseInputFields({
      version: 1,
      fields: [
        {
          key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text',
          multiline: true, required: true, order: 0, semantic: 'mainPrompt',
        },
        {
          key: 'video', kieField: 'video_list', label: 'ویدیو', type: 'video',
          accept: ['video/mp4'], wireShape: 'scalarUrl', required: false, order: 1,
        },
        {
          key: 'duration', kieField: 'duration', label: 'مدت', type: 'duration',
          mode: 'fixedList', fixedOptions: [4, 8], wireValueType: 'string', default: 4,
          omitWhen: { kind: 'fieldPresent', fieldKey: 'video' }, required: false, order: 2,
        },
        {
          key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
          options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
          wireValueType: 'string', semantic: 'aspectRatio',
          visibleWhen: { kind: 'fieldAbsent', fieldKey: 'video' },
          required: false, order: 3,
        },
      ],
    });

    const aspect = schema.fields.find((f) => f.key === 'aspectRatio');
    const duration = schema.fields.find((f) => f.key === 'duration');
    expect(aspect && 'visibleWhen' in aspect ? aspect.visibleWhen : undefined).toBeUndefined();
    expect(duration && duration.type === 'duration' ? duration.omitWhen : undefined).toEqual({
      kind: 'fieldPresent',
      fieldKey: 'video',
    });
  });

  it('leaves runway-style image constraints on aspectRatio alone', () => {
    const schema = keepAspectRatioVisibleWithVideo(
      parseInputFields({
        version: 1,
        fields: [
          {
            key: 'prompt', kieField: 'prompt', label: 'پرامپت', type: 'text',
            multiline: true, required: true, order: 0,
          },
          {
            key: 'imageUrl', kieField: 'image_url', label: 'عکس', type: 'image',
            accept: ['image/png'], required: false, order: 1,
          },
          {
            key: 'aspectRatio', kieField: 'aspect_ratio', label: 'ابعاد', type: 'enum',
            options: [{ value: '16:9', label: '16:9' }],
            wireValueType: 'string', semantic: 'aspectRatio',
            allowedOnlyWhen: { kind: 'fieldAbsent', fieldKey: 'imageUrl' },
            required: false, order: 2,
          },
        ],
      }),
    );
    const aspect = schema.fields.find((f) => f.key === 'aspectRatio');
    expect(aspect && 'allowedOnlyWhen' in aspect ? aspect.allowedOnlyWhen : undefined).toEqual({
      kind: 'fieldAbsent',
      fieldKey: 'imageUrl',
    });
  });
});
