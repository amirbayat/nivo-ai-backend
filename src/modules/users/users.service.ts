import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async updateMe(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(fa.users.notFound);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
      select: { id: true, phone: true, name: true, role: true },
    });

    return { message: fa.users.updated, user: updated };
  }
}
