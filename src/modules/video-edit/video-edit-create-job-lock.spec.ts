import { BadRequestException } from '@nestjs/common';
import { VideoEditService } from './video-edit.service';

jest.mock('../kie-video-models/input-fields.schema', () => ({
  parseInputFields: jest.fn(),
}));
jest.mock('../kie-video-models/generic-payload-builder', () => ({
  resolveEffectiveDurationSec: jest.fn(),
  validateInputValues: jest.fn(),
}));

type Opts = {
  activeJobs: number;
  balanceToman: number;
  maxConcurrent?: number;
  estimateToman?: number;
};

function setup(o: Opts) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => {
      calls.push('lock');
      return [];
    }),
    videoEditJob: {
      count: jest.fn(async () => {
        calls.push('count');
        return o.activeJobs;
      }),
      create: jest.fn(async () => {
        calls.push('create');
        return { id: 'job1' };
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    videoEditSession: {
      create: jest.fn().mockResolvedValue({ id: 's1', title: 'x' }),
      update: jest.fn(),
    },
  };
  const queue = { add: jest.fn(async () => calls.push('queue')) };
  const svc = Object.create(VideoEditService.prototype) as VideoEditService;
  Object.assign(svc, {
    prisma,
    videoEditQueue: queue,
    videoEditConfig: {
      getConfig: jest.fn().mockResolvedValue({
        isEnabled: true,
        maxConcurrentJobsPerUser: o.maxConcurrent ?? 1,
        maxJobsPerDayPerUser: null,
        generateFixedDurationSec: 5,
      }),
    },
    getActiveModelOrThrow: jest.fn().mockResolvedValue({
      id: 'm1',
      inputFields: null,
      pricePerSecondUsdConfirmed: 0.1,
      resolutions: ['720p'],
    }),
    validateAgainstMode: jest.fn(),
    pricing: {
      calcFlatCostToman: jest
        .fn()
        .mockResolvedValueOnce({ costToman: o.estimateToman ?? 800 })
        .mockResolvedValueOnce({ costToman: 100 }),
    },
    credits: {
      getBalance: jest.fn().mockResolvedValue({
        balanceToman: o.balanceToman,
        credits: 1,
        tomanPerCredit: 1000,
      }),
    },
    generateSessionTitle: jest.fn().mockResolvedValue(null),
  });
  return { svc, tx, queue, calls };
}

const dto = { mode: 'GENERATE', prompt: 'p', sessionId: undefined } as never;

describe('0.13r — createJob زیر قفل ردیف کیف‌پول', () => {
  it('اول قفل، بعد چک‌ها، بعد ساخت job داخل همان تراکنش؛ صف بعد از تراکنش', async () => {
    const { svc, calls } = setup({ activeJobs: 0, balanceToman: 5000 });
    await svc.createJob('u1', dto);
    expect(calls).toEqual(['lock', 'count', 'create', 'queue']);
  });

  it('سقف هم‌زمانی زیر قفل چک می‌شود: بدون ساخت job', async () => {
    const { svc, tx, queue } = setup({ activeJobs: 1, balanceToman: 5000 });
    await expect(svc.createJob('u1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.videoEditJob.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('هزینه‌ی jobهای در جریان از موجودی کم می‌شود (موجودی 1000، تخمین 800، یک job در جریان)', async () => {
    const { svc, tx } = setup({
      activeJobs: 1,
      maxConcurrent: 3,
      balanceToman: 1000,
    });
    await expect(svc.createJob('u1', dto)).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_CREDITS' },
    });
    expect(tx.videoEditJob.create).not.toHaveBeenCalled();
  });

  it('با موجودی کافی برای هر دو، job دوم مجاز است', async () => {
    const { svc, tx } = setup({
      activeJobs: 1,
      maxConcurrent: 3,
      balanceToman: 2000,
    });
    await svc.createJob('u1', dto);
    expect(tx.videoEditJob.create).toHaveBeenCalledTimes(1);
  });
});
