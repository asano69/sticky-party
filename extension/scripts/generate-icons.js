import sharp from "sharp";
import path from "node:path";

const input = path.resolve("public/wxt.svg");
const outputDir = path.resolve("public/icon");

const sizes = [16, 32, 48, 96, 128];

await Promise.all(
  sizes.map(async (size) => {
    const output = path.join(outputDir, `${size}.png`);

    await sharp(input).resize(size, size).png().toFile(output);

    console.log(`✓ ${size}.png`);
  }),
);
