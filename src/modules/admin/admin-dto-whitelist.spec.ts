import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { SetUserRoleDto } from './dto/set-user-role.dto';
import { UpdateCampaignDto } from '../campaign/dto/campaign.dto';
import { UpdateSegmentDto, UpdateTopicDto } from '../usage-analytics/dto/segment-topic.dto';

// R1.5 — همان ValidationPipe سراسری (whitelist + forbidNonWhitelisted): فیلد ناشناس ← خطا (۴۰۰)
async function errorsFor<T extends object>(cls: new () => T, body: object) {
  const instance = plainToInstance(cls, body);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('admin DTO whitelists [R1.5]', () => {
  it('PATCH users/:id فقط isActive؛ role یا هر ستون دیگر ← رد', async () => {
    expect(await errorsFor(UpdateAdminUserDto, { isActive: false })).toHaveLength(0);
    const withRole = await errorsFor(UpdateAdminUserDto, { role: 'ADMIN' });
    expect(withRole.some((e) => e.property === 'role')).toBe(true);
    const withColumn = await errorsFor(UpdateAdminUserDto, { isActive: true, passwordHash: 'x', referralCode: 'y' });
    expect(withColumn.length).toBeGreaterThan(0);
  });

  it('تغییر نقش فقط با دلیل معتبر و مقدار مجاز', async () => {
    expect(await errorsFor(SetUserRoleDto, { role: 'ADMIN', reason: 'ارتقا برای پشتیبانی' })).toHaveLength(0);
    expect((await errorsFor(SetUserRoleDto, { role: 'ROOT', reason: 'ارتقا برای پشتیبانی' })).length).toBeGreaterThan(0);
    expect((await errorsFor(SetUserRoleDto, { role: 'ADMIN', reason: 'x' })).length).toBeGreaterThan(0);
  });

  it('کمپین: status و grantedCount قابل نوشتن نیستند', async () => {
    expect(await errorsFor(UpdateCampaignDto, { capacity: 100, name: 'x' })).toHaveLength(0);
    expect((await errorsFor(UpdateCampaignDto, { grantedCount: 9999 })).some((e) => e.property === 'grantedCount')).toBe(true);
    expect((await errorsFor(UpdateCampaignDto, { status: 'ACTIVE' })).some((e) => e.property === 'status')).toBe(true);
  });

  it('segment و topic: فیلد ناشناس رد می‌شود', async () => {
    expect((await errorsFor(UpdateSegmentDto, { id: 'other', label: 'x' })).some((e) => e.property === 'id')).toBe(true);
    expect((await errorsFor(UpdateTopicDto, { createdAt: 'x' })).some((e) => e.property === 'createdAt')).toBe(true);
    expect(await errorsFor(UpdateTopicDto, { keywords: ['a', 'b'], isActive: true })).toHaveLength(0);
  });
});
