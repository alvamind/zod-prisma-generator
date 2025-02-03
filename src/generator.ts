// zod-prisma-generator/src/generator.ts
import { getSchema } from '@mrleebo/prisma-ast';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

type ModelDefinition = {
  name: string;
  fields: FieldDefinition[];
  isType: boolean;
};

type FieldDefinition = {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  attributes: string[];
};

type EnumDefinition = {
  name: string;
  values: string[];
};

export function generate(prismaSchemaPath: string) {
  const schemaContent = readFileSync(prismaSchemaPath, 'utf-8');
  const schema = getSchema(schemaContent);

  const models: ModelDefinition[] = [];
  const enums: EnumDefinition[] = [];
  const types: ModelDefinition[] = [];

  schema.list.forEach((node) => {
    switch (node.type) {
      case 'model':
        models.push(processObject(node, false));
        break;
      case 'enum':
        enums.push(processEnum(node));
        break;
      case 'type':
        types.push(processObject(node, true));
        break;
    }
  });

  const outputDir = path.join(process.cwd(), 'output');
  mkdirSync(outputDir, { recursive: true });

  // Generate enums first
  enums.forEach((enumDef) => generateEnum(enumDef, outputDir));

  // Generate types and models
  [...types, ...models].forEach((model) =>
    generateModel(model, models, enums, types, outputDir)
  );
}

function processObject(node: any, isType: boolean): ModelDefinition {
  return {
    name: node.name,
    isType,
    fields: node.properties
      .filter((prop: any) => prop.type === 'field')
      .map((prop: any) => ({
        name: prop.name,
        type: getFieldTypeName(prop.fieldType),
        isArray: prop.array || false,
        isOptional: prop.optional || false,
        attributes: (prop.attributes || []).map((a: any) => a.name),
      })),
  };
}

function getFieldTypeName(fieldType: string | { type: string; name: string }): string {
  return typeof fieldType === 'string' ? fieldType : fieldType.name;
}


function processEnum(node: any): EnumDefinition {
  return {
    name: node.name,
    values: node.enumerators
      .filter((e: any) => e.type === 'enumerator')
      .map((e: any) => e.name),
  };
}

function generateEnum(enumDef: EnumDefinition, outputDir: string) {
  const content =
    `import { z } from 'zod'\n\n` +
    `export const ${enumDef.name}Schema = z.enum([\n` +
    `  ${enumDef.values.map((v) => `'${v}'`).join(',\n  ')}\n])\n\n` +
    `export type ${enumDef.name} = z.infer<typeof ${enumDef.name}Schema>\n`;

  writeFileSync(path.join(outputDir, `${enumDef.name}.ts`), content);
}

function generateModel(
  model: ModelDefinition,
  allModels: ModelDefinition[],
  enums: EnumDefinition[],
  types: ModelDefinition[],
  outputDir: string
) {
  const imports = new Set<string>();
  let content = `import { z } from 'zod'\n`;

  const fields = model.fields
    .map((field) => {
      let zodType = getZodType(field.type, field, model, allModels, enums, types, imports);

      if (field.isArray) zodType = `z.array(${zodType})`;
      if (field.isOptional) zodType += '.nullish()';

      // Handle @unique attribute
      if (field.attributes.includes('unique')) {
        zodType += `.refine(val => true, { message: "Must be unique" })`;
      }

      return `  ${field.name}: ${zodType},`;
    })
    .join('\n');

  // Add imports
  imports.forEach((importName) => {
    content += `import { ${importName}Schema } from './${importName}'\n`;
  });

  content +=
    `\nexport const ${model.name}Schema = z.object({\n${fields}\n})\n\n` +
    `export type ${model.name} = z.infer<typeof ${model.name}Schema>\n`;

  writeFileSync(path.join(outputDir, `${model.name}.ts`), content);
}

function getZodType(
  type: string,
  field: FieldDefinition,
  currentModel: ModelDefinition,
  allModels: ModelDefinition[],
  enums: EnumDefinition[],
  types: ModelDefinition[],
  imports: Set<string>
): string {
  const cleanType = type.replace('[]', '');
  const isEnum = enums.some((e) => e.name === cleanType);
  const isModel = allModels.some((m) => m.name === cleanType && !m.isType);
  const isType = types.some((t) => t.name === cleanType);

  let zodType: string;

  switch (cleanType) {
    case 'String':
      zodType = 'z.string()';
      break;
    case 'Int':
    case 'Float':
      zodType = 'z.number()';
      break;
    case 'Boolean':
      zodType = 'z.boolean()';
      break;
    case 'DateTime':
      zodType = 'z.date()';
      break;
    case 'Json':
      zodType = 'z.any()';
      break;
    case 'Bytes':
      zodType = 'z.instanceof(Buffer)';
      break;
    case 'Decimal':
      zodType = 'z.string()';
      break;
    case 'BigInt':
      zodType = 'z.bigint()';
      break;
    default:
      if (isEnum) {
        zodType = `${cleanType}Schema`;
      } else if (isModel || isType) {
        if (cleanType !== currentModel.name) {
          imports.add(cleanType);
        }
        zodType = `z.lazy(() => ${cleanType}Schema)`;
      } else {
        zodType = 'z.string()'; // Default to string for unsupported types
      }
      break;
  }

  // Handle @nullable
  if (field.attributes.includes('nullable')) {
    zodType += '.nullable()';
  }

  return zodType;
}
