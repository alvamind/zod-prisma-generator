import { getSchema } from '@mrleebo/prisma-ast';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { z } from 'zod';

type ModelDefinition = {
  name: string;
  fields: FieldDefinition[];
  isType: boolean;
  comments: string[];
};

type FieldDefinition = {
  name: string;
  type: string;
  isArray: boolean;
  isOptional: boolean;
  attributes: string[];
  comment?: string;
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
  const properties = node.properties || [];
  const comments = properties
    .filter((prop: any) => prop.type === 'comment')
    .map((comment: any) => comment.text);

  return {
    name: node.name,
    isType,
    fields: properties
      .filter((prop: any) => prop.type === 'field')
      .map((prop: any) => ({
        name: prop.name,
        type: getFieldTypeName(prop.fieldType),
        isArray: prop.array || false,
        isOptional: prop.optional || false,
        attributes: (prop.attributes || []).map((a: any) => a.name),
        comment: prop.comment,
      })),
    comments
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

  if (model.comments && model.comments.length > 0) {
    content += model.comments.map(comment => `${comment}\n`).join('');
  }

  const fields = model.fields
    .map((field) => {
      if (field.comment) {
        content += `  ${field.comment}\n`;
      }
      let zodType = getZodType(field.type, field, model, allModels, enums, types, imports);

      if (field.isArray) zodType = `z.array(${zodType})`;
      if (field.isOptional) zodType += '.nullish()';

      if (field.attributes.includes('unique')) {
        zodType += `.refine(val => true, { message: "Must be unique" })`;
      }

      return `  ${field.name}: ${zodType},`;
    })
    .join('\n');

  // Add imports
  imports.forEach((importName) => {
    content += `import { ${importName}Schema } from './${importName}'\n`
  })

  // here is where we fix it. Check if fields is empty. If so, use an empty object, else, make it as it is.
  const objectContent = fields ? `{\n${fields}\n}` : `{}`;

  content +=
    `\nexport const ${model.name}Schema = z.object(${objectContent})\n\n` +
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
