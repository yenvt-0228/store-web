import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { RoleName } from '../common/constants/role.constant';
import { PrismaClient } from '../generated/prisma/client';
import { UserStatus } from '../generated/prisma/enums';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ROLES = [
  { name: RoleName.ADMIN, description: 'Quản trị website' },
  { name: RoleName.USER, description: 'User' },
];

async function main() {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
  }
  console.log(`Đã seed ${ROLES.length} role`);

  const email = process.env.ADMIN_EMAIL ?? 'admin@store-web.local';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';

  const admin = await prisma.user.upsert({
    where: { email },
    // Không ghi đè mật khẩu nếu admin đã tồn tại (tránh reset mật khẩu đã đổi).
    update: { isVerified: true, status: UserStatus.ACTIVE },
    create: {
      name: process.env.ADMIN_NAME ?? 'Administrator',
      email,
      password: await bcrypt.hash(password, 10),
      isVerified: true, // admin không cần kích hoạt qua email
      status: UserStatus.ACTIVE,
    },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.ADMIN },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log(`Tài khoản admin: ${email} / ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
