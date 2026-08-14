import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ParsePaperInputSchema,
  ParsePaperResultSchema,
  ToolErrorSchema,
} from "../src/index.ts";

const outputDirectory = resolve(
  "packages/contracts/schemas/parse_paper",
);

await mkdir(outputDirectory, { recursive: true });

const schemas = [
  ["input.schema.json", ParsePaperInputSchema],
  ["output.schema.json", ParsePaperResultSchema],
  ["error.schema.json", ToolErrorSchema],
] as const;

for (const [filename, schema] of schemas) {
  await writeFile(
    resolve(outputDirectory, filename),
    `${JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...schema,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

