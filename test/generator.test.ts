// zod-prisma-generator/test/generator.test.ts
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'fs';
import path from 'path';
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'bun:test';
import { generate } from '../src/generator';
import { $ } from 'bun';

const outputDir = path.join(process.cwd(), 'output');
const testSchemaDir = path.join(process.cwd(), 'test-schema');
const testSchemaPath = path.join(testSchemaDir, 'test.prisma');

// Helper function with precise reading
const readOutput = (fileName: string) => {
  const filePath = path.join(outputDir, fileName);
  return existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
};

// Helper function for writing test schemas
const setupTestSchema = (schema: string) => {
  writeFileSync(testSchemaPath, schema.trim().replace(/^\s+/gm, ''));
};


describe('Zod Schema Generator', () => {
  beforeAll(() => {
    $`clear`
    mkdirSync(testSchemaDir, { recursive: true });
    writeFileSync(
      testSchemaPath,
      `
        model User {
          id        Int      @id @default(autoincrement())
          email     String   @unique
          firstName String?
          lastName  String?
          posts     Post[]
          profile   Profile?
        }

        model Post {
          id        Int     @id @default(autoincrement())
          title     String
          content   String?
          author    User    @relation(fields: [authorId], references: [id])
          authorId  Int
        }

        model Profile {
          id        Int     @id @default(autoincrement())
          bio       String?
          userId    Int     @unique
          user      User    @relation(fields: [userId], references: [id])
        }

        enum UserRole {
          USER
          ADMIN
        }

        type CompositeType {
          fieldA String
          fieldB Int
        }
      `.trim().replace(/^\s+/gm, '') // Remove indentation whitespace
    );
  });

  afterAll(() => {
    [outputDir, testSchemaDir].forEach(dir => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    });
  });

  beforeEach(() => mkdirSync(outputDir, { recursive: true }));

  it('should generate exact User schema structure', () => {
    generate(testSchemaPath);
    const userSchema = readOutput('User.ts')?.trim();

    expect(userSchema).toContain(
      `import { z } from 'zod'
import { PostSchema } from './Post'
import { ProfileSchema } from './Profile'

export const UserSchema = z.object({
  id: z.number(),
  email: z.string().refine(val => true, { message: "Must be unique" }),
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  posts: z.array(z.lazy(() => PostSchema)),
  profile: z.lazy(() => ProfileSchema).nullish(),
})

export type User = z.infer<typeof UserSchema>`
    );
  });

  it('should generate exact Post schema structure', () => {
    generate(testSchemaPath);
    const postSchema = readOutput('Post.ts')?.trim();

    expect(postSchema).toContain(
      `import { z } from 'zod'
import { UserSchema } from './User'

export const PostSchema = z.object({
  id: z.number(),
  title: z.string(),
  content: z.string().nullish(),
  author: z.lazy(() => UserSchema),
  authorId: z.number(),
})

export type Post = z.infer<typeof PostSchema>`
    );
  });

  it('should generate exact Profile schema structure', () => {
    generate(testSchemaPath);
    const profileSchema = readOutput('Profile.ts')?.trim();

    expect(profileSchema).toContain(
      `import { z } from 'zod'
import { UserSchema } from './User'

export const ProfileSchema = z.object({
  id: z.number(),
  bio: z.string().nullish(),
  userId: z.number().refine(val => true, { message: "Must be unique" }),
  user: z.lazy(() => UserSchema),
})

export type Profile = z.infer<typeof ProfileSchema>`
    );
  });

  it('should generate exact UserRole enum structure', () => {
    generate(testSchemaPath);
    const enumSchema = readOutput('UserRole.ts')?.trim();

    expect(enumSchema).toBe(
      `import { z } from 'zod'

export const UserRoleSchema = z.enum([
  'USER',
  'ADMIN'
])

export type UserRole = z.infer<typeof UserRoleSchema>`
    );
  });

  it('should generate exact CompositeType structure', () => {
    generate(testSchemaPath);
    const compositeSchema = readOutput('CompositeType.ts')?.trim();

    expect(compositeSchema).toBe(
      `import { z } from 'zod'

export const CompositeTypeSchema = z.object({
  fieldA: z.string(),
  fieldB: z.number(),
})

export type CompositeType = z.infer<typeof CompositeTypeSchema>`
    );
  });


  it('should generate basic model with primitive types', () => {
    setupTestSchema(`
      model BasicTypes {
        id    Int    @id
        name  String
        age   Int?
        score Float
      }
    `);

    generate(testSchemaPath);
    expect(readOutput('BasicTypes.ts')?.trim()).toContain(
      `import { z } from 'zod'

export const BasicTypesSchema = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number().nullish(),
  score: z.number(),
})

export type BasicTypes = z.infer<typeof BasicTypesSchema>`
    );
  });

  // 1. BigInt Type
  it('should handle BigInt type', () => {
    setupTestSchema(`model BigIntModel {
      id BigInt @id
      }`);
    generate(testSchemaPath);
    expect(readOutput('BigIntModel.ts')?.trim()).toInclude('id: z.bigint()');
  });

  // 2. Bytes Type
  it('should handle Bytes type', () => {
    setupTestSchema(`model BytesModel {
      data Bytes
      }`);
    generate(testSchemaPath);
    expect(readOutput('BytesModel.ts')?.trim()).toInclude('data: z.instanceof(Buffer)');
  });

  // 3. Default Values
  it('should handle @default attributes', () => {
    setupTestSchema(`
      model Defaults {
        id      String  @id @default(cuid())
        active  Boolean @default(true)
        createdAt DateTime @default(now())
      }
    `);

    generate(testSchemaPath);
    const schema = readOutput('Defaults.ts')?.trim();
    expect(schema).toInclude('id: z.string()');
    expect(schema).toInclude('active: z.boolean()');
    expect(schema).toInclude('createdAt: z.date()');
  });

  // 4. JSON Type
  it('should handle Json type', () => {
    setupTestSchema(`model JsonModel {
      data Json
      }`);
    generate(testSchemaPath);
    expect(readOutput('JsonModel.ts')?.trim()).toInclude('data: z.any()');
  });

  // 5. UpdatedAt Attribute
  it('should handle @updatedAt', () => {
    setupTestSchema(`model Timestamps {
      updatedAt DateTime @updatedAt
      }`);
    generate(testSchemaPath);
    expect(readOutput('Timestamps.ts')?.trim()).toInclude('updatedAt: z.date()');
  });

  // 6. Map Attribute
  it('should handle @map attribute', () => {
    setupTestSchema(`
      model Mapped {
        id Int @id @map("primary_key")
        name String @map("full_name")
      }
    `);

    generate(testSchemaPath);
    const schema = readOutput('Mapped.ts')?.trim();
    expect(schema).toInclude('id: z.number()');
    expect(schema).toInclude('name: z.string()');
  });

  // 7. Self Relations
  it('should handle self-relations', () => {
    setupTestSchema(`
      model Employee {
        id       Int       @id
        manager  Employee? @relation("Management")
        reports  Employee[] @relation("Management")
      }
    `);

    generate(testSchemaPath);
    const schema = readOutput('Employee.ts')?.trim();
    expect(schema).toInclude('manager: z.lazy(() => EmployeeSchema).nullish()');
    expect(schema).toInclude('reports: z.array(z.lazy(() => EmployeeSchema))');
  });

  // 8. Multi-field IDs
  it('should handle @@id', () => {
    setupTestSchema(`
      model CompoundId {
        a Int
        b Int
        @@id([a, b])
      }
    `);

    generate(testSchemaPath);
    expect(readOutput('CompoundId.ts')?.trim()).toBe(
      `import { z } from 'zod'

export const CompoundIdSchema = z.object({
  a: z.number(),
  b: z.number(),
})

export type CompoundId = z.infer<typeof CompoundIdSchema>`
    );
  });

  // 9. Indexes
  it('should ignore @@index', () => {
    setupTestSchema(`
      model Indexed {
        id Int @id
        name String
        @@index([name])
      }
    `);

    generate(testSchemaPath);
    expect(readOutput('Indexed.ts')?.trim()).not.toInclude('@@index');
  });

  // 10. Optional vs Nullable
  it('should differentiate optional and nullable', () => {
    setupTestSchema(`
      model NullOptional {
        opt String?
        nul String @nullable
      }
    `);

    generate(testSchemaPath);
    const schema = readOutput('NullOptional.ts')?.trim();
    expect(schema).toInclude('opt: z.string().nullish()');
    expect(schema).toInclude('nul: z.string().nullable()');
  });

  // 11. Enum Arrays
  it('should handle enum arrays', () => {
    setupTestSchema(`
      enum Role {
      USER
      ADMIN
      }
      model User {
        id   Int    @id
        roles Role[]
      }
    `);

    generate(testSchemaPath);
    const userSchema = readOutput('User.ts')?.trim();
    expect(userSchema).toInclude('roles: z.array(RoleSchema)');
  });

  // 12. Decimal Type
  it('should handle Decimal type', () => {
    setupTestSchema(`model Money {
      amount Decimal
      }`);
    generate(testSchemaPath);
    expect(readOutput('Money.ts')?.trim()).toInclude('amount: z.string()');
  });

  // 13. Unsupported Types
  it('should mark unsupported types as string', () => {
    setupTestSchema(`model Unsupported {
      data UnsupportedType
      }`);
    generate(testSchemaPath);
    expect(readOutput('Unsupported.ts')?.trim()).toInclude('data: z.string()');
  });


  // 14. Map Enum
  it('should handle mapped enums', () => {
    setupTestSchema(`
      enum MappedEnum {
        A @map("alpha")
        B @map("beta")
      }
    `);

    generate(testSchemaPath);
    expect(readOutput('MappedEnum.ts')?.trim()).toBe(
      `import { z } from 'zod'

export const MappedEnumSchema = z.enum([
  'A',
  'B'
])

export type MappedEnum = z.infer<typeof MappedEnumSchema>`
    );
  });

  // 15. Custom Type Comments
  it('should preserve comments', () => {
    setupTestSchema(`
        /// User model comment
        model Commented {
          /// Field comment
          id Int @id
        }
      `);

    generate(testSchemaPath);
    const schema = readOutput('Commented.ts')?.trim();
    expect(schema).toContain('/// User model comment');
    expect(schema).toContain('/// Field comment');
  });

  // 16. Type Aliases
  it('should handle type aliases', () => {
    setupTestSchema(`
      type Address {
        street String
        city String
      }
    `);

    generate(testSchemaPath);
    expect(readOutput('Address.ts')?.trim()).toBe(
      `import { z } from 'zod'

export const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
})

export type Address = z.infer<typeof AddressSchema>`
    );
  });

  // 17. Multi-schema Files
  it('should handle multiple schemas', () => {
    setupTestSchema(`
      model A {
      id Int @id
      }
      model B {
      id Int @id
      a A @relation(fields: [aId], references: [id])
      aId Int }
    `);

    generate(testSchemaPath);
    const bSchema = readOutput('B.ts')?.trim();
    expect(bSchema).toInclude('a: z.lazy(() => ASchema)');
  });

  // 18. Field Name Sanitization
  it('should sanitize reserved keywords', () => {
    setupTestSchema(`model Reserved {
      delete Boolean
      }`);
    generate(testSchemaPath);
    expect(readOutput('Reserved.ts')?.trim()).toInclude('delete: z.boolean()');
  });

  // 19. Empty Model
  it('should handle empty models', () => {
    setupTestSchema(`model Empty {
}`); // Note the whitespace now inside
    generate(testSchemaPath);
    expect(readOutput('Empty.ts')?.trim()).toBe(
      `import { z } from 'zod'

export const EmptySchema = z.object({})

export type Empty = z.infer<typeof EmptySchema>`
    );
  });

  // 20. Complex Composite Types
  it('should handle nested composite types', () => {
    setupTestSchema(`
      type Address {
        street String
        city String
        coordinates Coordinate
      }

      type Coordinate {
        lat Float
        lng Float
      }
    `);

    generate(testSchemaPath);
    const addressSchema = readOutput('Address.ts')?.trim();
    expect(addressSchema).toInclude('coordinates: z.lazy(() => CoordinateSchema)');
  });
});
